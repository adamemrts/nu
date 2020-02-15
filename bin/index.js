#!/usr/bin/env node

const http = require('http')
const handler = require('serve-handler')
const consola = require('consola')

const errorTemplate = require('../views/error.js')

const timers = {}

consola.time = function (name) {
  if (name) {
    timers[name] = Date.now()
  }
}

consola.timeEnd = function (name, ...payload) {
  if (timers[name]) {
    consola.info(`${name}${payload && payload.length ? ' ' + payload.join(' ') : ''}`, '[' + (Date.now() - timers[name]) + 'ms]')
    delete timers[name]
  }
}

consola.successEnd = function (name, ...payload) {
  if (timers[name]) {
    consola.success(`${name}${payload && payload.length ? ' ' + payload.join(' ') : ''}`, '[' + (Date.now() - timers[name]) + 'ms]')
    delete timers[name]
  }
}

const addHelpers = require('../addHelpers.js')
const fs = require('fs')
const nodemon = require('nodemon')

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

// create a server object:
const server = http.createServer(async function (req, res) {
  addLogger(req, res)
  if (req.url.startsWith('/api/')) {
    const script = files.find(filename => req.url.startsWith('/api/' + filename))
    if (script && fs.existsSync(directory + '/api/' + script)) {
      await addHelpers(req, res)
      if (require.cache[require.resolve(directory + '/api/' + script)]) {
        delete require.cache[require.resolve(directory + '/api/' + script)]
      }
      try {
        const func = require(directory + '/api/' + script)
        return func(req, res)
      } catch {
        const template = errorTemplate({ statusCode: 500, message: 'Intrnal server error' })

        return res.send(template)
      }
    }
  }
  return handler(req, res, {
    public: directory + '/public'
  })
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

initServer().then(port => {
  consola.success(`Server listening on port: ${port}`)

  const build = pkg && pkg.scripts && (pkg.scripts.build || pkg.scripts['now-build'])

  if (build) {
    consola.info(`Running '${build}'`)
    const msg = `Done '${build}'`
    nodemon({ exec: build, ignore: ['public/*', 'api/*'] })
      .on('start', () => consola.time(msg))
      .on('exit', () => consola.successEnd(msg))
      .on('crash', () => consola.error('Script crashed', build))
  }
})
