import puppeteer from 'puppeteer'
import genericPool from 'generic-pool'
import initDebug from 'debug'
const debug = initDebug('puppeteer-pool')
let regeneratorRuntime = require('regenerator-runtime')

const initPuppeteerPool = ({
  max = 10,
  // optional. if you set this, make sure to drain() (see step 3)
  min = 2,
  // specifies how long a resource can stay idle in pool before being removed
  idleTimeoutMillis = 30000,
  // specifies the maximum number of times a resource can be reused before being destroyed
  maxUses = 50,
  testOnBorrow = true,
  puppeteerArgs = [],
  validator = () => Promise.resolve(true),
  ...otherConfig
} = {}) => {
  // TODO: randomly destroy old instances to avoid resource leak?
  const factory = {
    create: () => puppeteer.launch(...puppeteerArgs).then(async instance => {
      const page = await instance.newPage()
      await page.setRequestInterceptionEnabled(true)
      debug('new page from browser.newPage()')
      return {
        instance,
        useCount: 0,
        page
      }
    }),
    destroy: ({page, instance}) => {
      debug('page.close()')
      page.close()
      debug('instance.close()')
      instance.close()
    },
    validate: (instance) => {
      return validator(instance)
        .then(valid => Promise.resolve(valid && (maxUses <= 0 || instance.useCount < maxUses)))
    },
  }
  const config = {
    max,
    min,
    idleTimeoutMillis,
    testOnBorrow,
    ...otherConfig,
  }
  const pool = genericPool.createPool(factory, config)
  const genericAcquire = pool.acquire.bind(pool)
  pool.acquire = () => genericAcquire().then(instance => {
    instance.useCount += 1
    debug('incremented useCount:', instance.useCount)
    return instance
  })
  pool.use = (fn) => {
    let resource
    return pool.acquire()
      .then(r => {
        resource = r
        return resource
      })
      .then(fn)
      .then((result) => {
        pool.release(resource)
        return result
      }, (err) => {
        pool.release(resource)
        throw err
      })
  }

  return pool
}

// To avoid breaking backwards compatibility
// https://github.com/binded/phantom-pool/issues/12
initPuppeteerPool.default = initPuppeteerPool

export default initPuppeteerPool
