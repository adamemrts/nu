function getBodyParser (req, body) {
  return function parseBody () {
    if (!req.headers['content-type']) {
      return undefined
    }
    const { parse: parseContentType } = require('content-type')
    const { type } = parseContentType(req.headers['content-type'])
    if (type === 'application/json') {
      try {
        const str = body.toString()
        return str ? JSON.parse(str) : {}
      } catch (error) {
        throw new ApiError(400, 'Invalid JSON')
      }
    }
    if (type === 'application/octet-stream') {
      return body
    }
    if (type === 'application/x-www-form-urlencoded') {
      const { parse: parseQS } = require('querystring')
      // note: querystring.parse does not produce an iterable object
      // https://nodejs.org/api/querystring.html#querystring_querystring_parse_str_sep_eq_options
      return parseQS(body.toString())
    }
    if (type === 'text/plain') {
      return body.toString()
    }
    return undefined
  }
}
function getQueryParser ({ url = '/' }) {
  return function parseQuery () {
    const { URL } = require('url')
    // we provide a placeholder base url because we only want searchParams
    const params = new URL(url, 'https://n').searchParams
    const query = {}
    for (const [key, value] of params) {
      query[key] = value
    }
    return query
  }
}
function getCookieParser (req) {
  return function parseCookie () {
    const header = req.headers.cookie
    if (!header) {
      return {}
    }
    const { parse } = require('cookie')
    return parse(Array.isArray(header) ? header.join(';') : header)
  }
}
function status (res, statusCode) {
  res.statusCode = statusCode
  return res
}
function setCharset (type, charset) {
  const { parse, format } = require('content-type')
  const parsed = parse(type)
  parsed.parameters.charset = charset
  return format(parsed)
}
function createETag (body, encoding) {
  const etag = require('etag')
  const buf = !Buffer.isBuffer(body) ? Buffer.from(body, encoding) : body
  return etag(buf, { weak: true })
}
function send (req, res, body) {
  let chunk = body
  let encoding
  switch (typeof chunk) {
    // string defaulting to html
    case 'string':
      if (!res.getHeader('content-type')) {
        res.setHeader('content-type', 'text/html')
      }
      break
    case 'boolean':
    case 'number':
    case 'object':
      if (chunk === null) {
        chunk = ''
      } else if (Buffer.isBuffer(chunk)) {
        if (!res.getHeader('content-type')) {
          res.setHeader('content-type', 'application/octet-stream')
        }
      } else {
        return json(req, res, chunk)
      }
      break
  }
  // write strings in utf-8
  if (typeof chunk === 'string') {
    encoding = 'utf8'
    // reflect this in content-type
    const type = res.getHeader('content-type')
    if (typeof type === 'string') {
      res.setHeader('content-type', setCharset(type, 'utf-8'))
    }
  }
  // populate Content-Length
  let len
  if (chunk !== undefined) {
    if (Buffer.isBuffer(chunk)) {
      // get length of Buffer
      len = chunk.length
    } else if (typeof chunk === 'string') {
      if (chunk.length < 1000) {
        // just calculate length small chunk
        len = Buffer.byteLength(chunk, encoding)
      } else {
        // convert chunk to Buffer and calculate
        const buf = Buffer.from(chunk, encoding)
        len = buf.length
        chunk = buf
        encoding = undefined
      }
    } else {
      throw new Error('`body` is not a valid string, object, boolean, number, Stream, or Buffer')
    }
    if (len !== undefined) {
      res.setHeader('content-length', len)
    }
  }
  // populate ETag
  let etag
  if (!res.getHeader('etag') &&
        len !== undefined &&
        (etag = createETag(chunk, encoding))) {
    res.setHeader('etag', etag)
  }
  // strip irrelevant headers
  if (res.statusCode === 204 || res.statusCode === 304) {
    res.removeHeader('Content-Type')
    res.removeHeader('Content-Length')
    res.removeHeader('Transfer-Encoding')
    chunk = ''
  }
  if (req.method === 'HEAD') {
    // skip body for HEAD
    res.end()
  } else if (encoding) {
    // respond with encoding
    res.end(chunk, encoding)
  } else {
    // respond without encoding
    res.end(chunk)
  }
  return res
}
function json (req, res, jsonBody) {
  const body = JSON.stringify(jsonBody)
  // content-type
  if (!res.getHeader('content-type')) {
    res.setHeader('content-type', 'application/json; charset=utf-8')
  }
  return send(req, res, body)
}
class ApiError extends Error {
  constructor (statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}
// function sendError (res, statusCode, message) {
//   res.statusCode = statusCode
//   res.statusMessage = message
//   res.end()
// }
function setLazyProp (req, prop, getter) {
  const opts = { configurable: true, enumerable: true }
  const optsReset = Object.assign(Object.assign({}, opts), { writable: true })
  Object.defineProperty(req, prop, Object.assign(Object.assign({}, opts), {
    get: () => {
      const value = getter()
      // we set the property on the object to avoid recalculating it
      Object.defineProperty(req, prop, Object.assign(Object.assign({}, optsReset), { value }))
      return value
    },
    set: value => {
      Object.defineProperty(req, prop, Object.assign(Object.assign({}, optsReset), { value }))
    }
  }))
}
module.exports = function addHelpers (req, res) {
  return new Promise((resolve, reject) => {
    const data = []
    req.on('data', chunk => {
      data.push(chunk)
    })
    req.on('end', () => {
      const body = data
      setLazyProp(req, 'cookies', getCookieParser(req))
      setLazyProp(req, 'query', getQueryParser(req))
      setLazyProp(req, 'body', getBodyParser(req, body))
      res.status = statusCode => status(res, statusCode)
      res.send = body => send(req, res, body)
      res.json = jsonBody => json(req, res, jsonBody)
      resolve()
    })
  })
}
