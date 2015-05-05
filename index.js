let express = require('express')
let morgan = require('morgan')
let nodeify = require('bluebird-nodeify')
//let bluebird = require('bluebird')
let fs = require('fs')
let path = require('path')
let mime = require('mime-types')
let rimraf = require('rimraf')
let mkdirp = require('mkdirp')
let bodyParser = require('body-parser');
let jot = require('json-over-tcp');

let argv = require('yargs')
  .usage('\nUsage: $0 [options]')
    .help('help').alias('help', 'h')
  .version('1.0.0', 'version').alias('version', 'V')
  .options({
    dir: {
        description: "Destination directory"
    }
  })
  .example('$0 --dir /some/root/dir', 'Uses destination directory')
  .epilog('See https://github.com/ksangani/node-proj-dropbox#readme for details')
  .argv

require('songbird')
//require('longjohn')

const NODE_ENV = process.env.NODE_ENV || 'dev'
const PORT = process.env.PORT || 8000
const ROOT_DIR = path.resolve(argv.dir || process.cwd())

//bluebird.longStackTraces()

let app = express()

if (NODE_ENV === 'dev') {
  //app.use(express.errorHandler())
  app.use(morgan('dev'))
}

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({
    extended: true
})) 

console.log(`Using root dir@${ROOT_DIR}`)

// HTTP
app.listen(PORT, () => console.log(`HTTP server listening @http://127.0.0.1:${PORT}`))

app.head('*', setFileMeta, setHeaders, (req, res) => res.end())

app.get('*', setFileMeta, setHeaders, (req, res) => {
    if(!req.stat) return res.status(400).send('Invalid Path')
    if(res.body) return res.send(res.body)    
    fs.createReadStream(req.filePath).pipe(res)
})

app.put('*', setFileMeta, setDirMeta, (req, res, next) => {
    async () => {
        if(req.stat) return res.status(405).send('Path exists')
        await mkdirp.promise(req.dirPath)    
        if(!req.isDir) {
            req.pipe(fs.createWriteStream(req.filePath))
            // let buffer = await fs.promise.readFile(req.filePath)
            // console.log(buffer)
            sendOverTcp(TCP.UPDATE, req.path, TCP.FILE, null)
        }
        res.end()
    }().catch(next)
})

app.post('*', setFileMeta, setDirMeta, (req, res, next) => {
    async () => {
        if(req.isDir) return res.status(405).send('Path is a directory')            
        if(!req.stat) return res.status(405).send('File does not exist')

        await fs.promise.truncate(req.filePath, 0)
        req.pipe(fs.createWriteStream(req.filePath))
        res.end()
        sendOverTcp(TCP.UPDATE, req.path, TCP.FILE, null)
    }().catch(next)
})

app.delete('*', setFileMeta, (req, res, next) => {
    async () => {
        if(!req.stat) return res.status(405).send('Path does not exist')
        if(req.stat.isDirectory()) {
            await rimraf.promise(req.filePath)
            sendOverTcp(TCP.DELETE, req.path, TCP.DIR, null)
        } else {
            await fs.promise.unlink(req.filePath)
            sendOverTcp(TCP.DELETE, req.path, TCP.FILE, null)
        }
        res.end()
    }().catch(next)
})

function setDirMeta(req, res, next) {
    let endsWithPath = req.filePath.charAt(req.filePath.length - 1) === path.sep
    let hasExt = path.extname(req.filePath) !== ''
    req.isDir = endsWithPath || !hasExt
    req.dirPath = req.isDir ? req.filePath : path.dirname(req.filePath)
    next()
}

function setFileMeta(req, res, next) {
    let filePath = path.resolve(path.join(ROOT_DIR, req.url))
    if(filePath.indexOf(ROOT_DIR) !== 0) {
        res.status(400).send('Invalid Path')
        return
    }

    req.filePath = filePath
    fs.promise.stat(filePath)
      .then(stat => req.stat = stat, () => req.stat = null)
      .nodeify(next)
}

function setHeaders(req, res, next) {
    nodeify(async () => {
        if(!req.stat) return res.status(400).send('Invalid Path')
        if (req.stat.isDirectory()) {
            let files = await fs.promise.readdir(req.filePath)
            res.body = JSON.stringify(files)
            res.setHeader('Content-Length', res.body.length)
            res.setHeader('Content-Type', 'application/json')
            return
        }
        res.setHeader('Content-Length', req.stat.size)
        res.setHeader('Content-Type', mime.contentType(path.extname(req.filePath)))
    }(), next)
}


// TCP
const TCP = {
    "PORT" : "8888",
    "FILE" : "file",
    "DIR" : "dir",
    "CREATE" : "create",
    "UPDATE" : "update",
    "DELETE" : "delete"
}

let server = jot.createServer(TCP.PORT);
let clients = [];

server.on('connection', (socket) => {
    clients.push(socket)
    socket.on('close', () => clients.remove(socket))
});

server.listen(TCP.PORT, () => console.log(`TCP server listening @tcp://127.0.0.1:${TCP.PORT}`))

async function sendOverTcp(action, path, type, contents, updated) {
    await clients.forEach((client) => client.write({
        "action": action,
        "path": path,
        "type": type,
        "contents": contents,
        "updated": Date.now()
    }))
}