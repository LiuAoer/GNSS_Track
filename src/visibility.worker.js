import { createCatalog } from './data.js';
import { calculateDay } from './visibility.js';

self.onmessage = ({ data: { payload, query } }) => {
  try {
    const satellites = createCatalog(payload).filter(sat => query.systemIds.includes(sat.system.id));
    const result = calculateDay(satellites, query.observer, query.date, query.utcOffset, progress => self.postMessage({ progress }));
    self.postMessage({ result });
  } catch (error) { self.postMessage({ error: error.message }); }
};
