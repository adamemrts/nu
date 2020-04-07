#!/usr/bin/env node
const consola = require('../utils/consola.js')
const purgeCache = require('../utils/purgeCache.js')

const moduleCache = process.argv.includes('-mc') || process.argv.includes('--moduleCache') || process.argv.includes('--module-cache') || false
consola.info(`Running lambdas with${moduleCache ? '' : 'out'} cache`)

const quiet = process.argv.includes('-q') || process.argv.includes('--quiet') || false
if (quiet) {
  console.log = () => {}
  console.time = () => {}
  console.timeEnd = () => {}
}

const http = require('http')
const handler = require('serve-handler')

const errorTemplate = require('../utils/error.js')

const addHelpers = require('../utils/addHelpers.js')
const fs = require('fs')

const directory = process.cwd()
const files = fs.existsSync(directory + '/api')
  ? fs.readdirSync(directory + '/api')
  : []
const pkg = fs.existsSync(directory + '/package.json')
  ? require(directory + '/package.json')
  : undefined

const addLogger = (req, res) => {
  const name = `${req.method} ${req.url}`
  consola.time(name)

  res.on('finish', () => {
    const log = `${res.statusCode} ${res.statusMessage}`
    if (res.statusCode === 200) {
      consola.successEnd(name, log)
    } else {
      consola.timeEnd(name, log)
    }
  })
}

const lambdaErrorHandler = (error, res) => {
  const template = errorTemplate({ statusCode: 505, message: 'Internal Server Error' })
  if (error) consola.error(error)
  return res.status(500).send(template)
}

// create a server object:
const server = http.createServer(async function (req, res) {
  addLogger(req, res)
  if (req.url.startsWith('/api/')) {
    const script = files.find(filename => req.url.startsWith('/api/' + filename))
    const module = directory + '/api/' + script
    if (script && fs.existsSync(module)) {
      await addHelpers(req, res)
      if (!moduleCache) purgeCache(module)
      try {
        const func = require(module)
        return func(req, res)
          .catch(err => lambdaErrorHandler(err, res))
      } catch (err) {
        lambdaErrorHandler(err, res)
      }
    }
  } else {
    return handler(req, res, {
      public: directory + '/public'
    })
  }
})

const closeServer = async () => {
  // Destroy server by forcing every connection to be closed
  if (server && server.listening) {
    await server.destroy()
    consola.debug('server closed')
  }
}

const initServer = (port = 3000) => {
  return new Promise((resolve, reject) => {
    server.on('error', error => reject(error))
    server.listen(port, error => error ? reject(error) : resolve(port))
  }).catch(err => serverErrorHandler(err, port))
}

const serverErrorHandler = async (error, port) => {
  // Detect if port is not available
  const addressInUse = error.code === 'EADDRINUSE'

  // Use better error message
  if (addressInUse) {
    error.message = `Port \`${port}\` is already in use.`

    consola.warn(error.message)
    consola.info('Trying a random port...')
    const RANDOM_PORT = Math.floor(Math.random() * 111) + 3333
    await closeServer()
    return initServer(RANDOM_PORT)
  }
}

const nodemon = require('nodemon')
const nodemonQuiet = {
  stdout: false,
  readable: false,
  quiet: true
}

initServer().then(port => {
  consola.success(`Server listening on port: ${port}`)

  const build = pkg && pkg.scripts && (pkg.scripts.build || pkg.scripts['now-build'])

  if (build) {
    consola.info(`Running '${build}'`)
    const msg = `Done '${build}'`
    nodemon(quiet
      ? {
        exec: build,
        ignore: ['public/*', 'api/*'],
        ...nodemonQuiet
      }
      : {
        exec: build,
        ignore: ['public/*', 'api/*']
      })
      .on('start', () => consola.time(msg))
      .on('exit', () => consola.successEnd(msg))
      .on('crash', () => consola.error('Script crashed', build))
  }
})
