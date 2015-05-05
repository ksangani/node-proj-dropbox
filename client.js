let fs = require('fs')
let path = require('path')
let jot = require('json-over-tcp')
let rimraf = require('rimraf')
let mkdirp = require('mkdirp')
let constants = require('./constants')
require('songbird')

let argv = require('yargs')
  .usage('\nUsage: $0 [options]')
  .help('help').alias('help', 'h')
  .version('1.0.0', 'version').alias('version', 'V')
  .options({
    dir: {
        description: "Destination directory (default: process.cwd())"
    }
  })
  .example('$0 --dir /some/root/dir', 'Uses destination directory')
  .epilog('See https://github.com/ksangani/node-proj-dropbox#readme for details')
  .argv

const ROOT_DIR = path.resolve(argv.dir || process.cwd())
console.log(`Using destination dir@${ROOT_DIR}`)

let socket = jot.connect(constants.TCP_PORT, () => console.log(`Connected to server @tcp://127.0.0.1:${constants.TCP_PORT}`))

socket.on('data', (data) => {
  console.log(`Performing [${data.action}] at path [${data.path}]`)
  let destPath = path.join(ROOT_DIR, data.path)
  if (data.type === constants.DIR) {
    handleDir(data, destPath)
      .catch(err => console.log(err))
  } else if (data.type === constants.FILE){
    handleFile(data, destPath)
      .catch(err => console.log(err))
  }
})

async function handleDir(data, destPath) {
    if (data.action === constants.CREATE) {
      await mkdirp.promise(destPath)
    }
    else if (data.action === constants.DELETE) {
      await rimraf.promise(destPath)
    }
}

async function handleFile(data, destPath) {
    if (data.action === constants.CREATE) {
      await mkdirp.promise(path.dirname(destPath))
      await fs.promise.writeFile(destPath, Buffer(data.contents, constants.BASE_64))
    }
    else if (data.action === constants.DELETE) {
      await fs.promise.unlink(destPath)
    }
    else if (data.action === constants.UPDATE) {
      await fs.promise.truncate(destPath, 0)
      await fs.promise.writeFile(destPath, Buffer(data.contents, constants.BASE_64))
    }
}