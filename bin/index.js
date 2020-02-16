#!/usr/bin/env node
const consola = require('consola')

const moduleCache = process.argv.includes('-mc') || process.argv.includes('--moduleCache') || process.argv.includes('--module-cache') || false
consola.info(`Running lambdas with${moduleCache ? '' : 'out'} cache`)
/**
 * Removes a module from the cache
 */
function purgeCache (moduleName) {
  // Traverse the cache looking for the files
  // loaded by the specified module name
  searchCache(moduleName, function (mod) {
    delete require.cache[mod.id]
  })

  // Remove cached paths to the module.
  // Thanks to @bentael for pointing this out.
  Object.keys(module.constructor._pathCache).forEach(function (cacheKey) {
    if (cacheKey.indexOf(moduleName) > 0) {
      delete module.constructor._pathCache[cacheKey]
    }
  })
}

/**
* Traverses the cache to search for all the cached
* files of the specified module name
*/
function searchCache (moduleName, callback) {
  // Resolve the module identified by the specified name
  var mod = require.resolve(moduleName)

  // Check if the module has been resolved and found within
  // the cache
  if (mod && ((mod = require.cache[mod]) !== undefined)) {
    // Recursively go over the results
    (function traverse (mod) {
      // Go over each of the module's children and
      // traverse them
      mod.children.forEach(function (child) {
        traverse(child)
      })

      // Call the specified callback providing the
      // found cached module
      callback(mod)
    }(mod))
  }
}

const quiet = process.argv.includes('-q') || process.argv.includes('--quiet') || false
if (quiet) {
  console.log = () => {}
  console.time = () => {}
  console.timeEnd = () => {}
}

const http = require('http')
const handler = require('serve-handler')

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
    const module = directory + '/api/' + script
    if (script && fs.existsSync(module)) {
      await addHelpers(req, res)
      if (!moduleCache) purgeCache(module)
      try {
        const func = require(module)
        return func(req, res)
      } catch (err) {
        const template = errorTemplate({ statusCode: 500, message: 'Internal Server Error' })
        if (err) consola.error(err)
        return res.status(500).send(template)
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
