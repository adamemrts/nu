const consola = require('consola')

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

module.exports = consola
