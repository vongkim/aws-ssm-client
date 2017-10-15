/**
 * This client has been closely adopted from
 * https://github.com/theburningmonk/lambda-config-demo/blob/master/lib/configClient.js
 */

import AWS from 'aws-sdk'
import co from 'co'
import debug from 'debug'

const logger = {
    debug : debug('ssm-client:debug'),
    error : debug('ssm-client:error'),
}

const ssm = new AWS.SSM()
const DEFAULT_EXPIRY = 5 * 60 * 1000 // default expiry is 5 mins

export const load = (keys = [], expiryMs = DEFAULT_EXPIRY) => {

  const cache = {
    expiration: 0,
    items: {},
  }

  const validate = (keys, params) => {
    let missing = keys.filter(k => params[k] === undefined)
    if (missing.length > 0) {
      throw new Error(`missing keys: ${missing}`)
    }
  }

  const reload = co.wrap(function* () {
    logger.debug(`loading cache keys: ${keys}`)

    const req = {
      Names: keys,
      WithDecryption: true,
    }

    const resp = yield ssm
      .getParameters(req)
      .promise()
      .catch(e => {
        throw e
      })

    const params = {}

    for (let param of resp.Parameters) {
      params[param.Name] = param.Value
    }

    validate(keys, params)

    if (expiryMs > 0) {
      cache.expiration = Date.now() + expiryMs
    }

    cache.items = params

  })

  const getValue = co.wrap(function* (key) {
    try {

      if (cache.items.length > 0 && (Date.now() <= cache.expiration || cache.expiration === 0)) {
        return cache.items[key]
      }

      yield reload()
      return cache.items[key]
    }
    catch (err) {
      if (cache.items.length > 0) {
        // swallow exception if cache is stale, as we'll just try again next time
        logger.debug('[WARN] swallowing error from SSM Parameter Store:\n', err)
        return cache.items[key]
      }

      logger.debug(`[ERROR] couldn't fetch the initial configs : ${keys}`)
      logger.error(err)

      throw err
    }
  })

  const config = {}

  for (let key of keys) {
    Object.defineProperty(config, key, {
      get: () => getValue(key),
      enumerable: true,
    })
  }

  return config
}

export default { load }

