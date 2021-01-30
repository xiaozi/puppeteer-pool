import puppeteer from 'puppeteer';
import genericPool from 'generic-pool';

const initPuppeteerPool = ({
  max = 10,
  // optional. if you set this, make sure to drain() (see step 3)
  min = 2,
  // specifies how long a resource can stay idle in pool before being removed
  idleTimeoutMillis = 30000,
  // specifies the maximum number of times a resource can be reused before being destroyed
  maxUses = 50,
  testOnBorrow = true,
  puppeteerArgs = {},
  validator = () => Promise.resolve(true),
  ...otherConfig
} = {}) => {
  // TODO: randomly destroy old instances to avoid resource leak?
  const cachedInstances = {};
  const factory = {
    create: () =>
      puppeteer.launch({ ...puppeteerArgs }).then(instance => {
        const pid = instance.process().pid;
        cachedInstances[pid] = {
          useCount: 0,
          valid: true
        };
        return instance;
      }),
    destroy: instance => {
      const pid = instance.process().pid;
      delete cachedInstances[pid];
      instance.close();
    },
    validate: instance => {
      return validator(instance).then(valid => {
        const pid = instance.process().pid;
        const useCount = cachedInstances[pid].useCount;
        return Promise.resolve(
          valid &&
            cachedInstances[pid].valid &&
            (maxUses <= 0 || useCount < maxUses)
        );
      });
    }
  };
  const config = {
    max,
    min,
    idleTimeoutMillis,
    testOnBorrow,
    ...otherConfig
  };

  const pool = genericPool.createPool(factory, config);
  const genericAcquire = pool.acquire.bind(pool);
  pool.acquire = () =>
    genericAcquire().then(instance => {
      const pid = instance.process().pid;
      cachedInstances[pid].useCount += 1;
      return instance;
    });
  pool.use = fn => {
    let resource;
    return pool
      .acquire()
      .then(r => {
        resource = r;
        return resource;
      })
      .then(fn)
      .then(
        result => {
          pool.release(resource);
          return result;
        },
        err => {
          pool.release(resource);
          throw err;
        }
      );
  };
  pool.invalidate = instance => {
    const pid = instance.process().pid;
    cachedInstances[pid].valid = false;
  };

  return pool;
};

// To avoid breaking backwards compatibility
// https://github.com/binded/phantom-pool/issues/12
initPuppeteerPool.default = initPuppeteerPool;

export default initPuppeteerPool;