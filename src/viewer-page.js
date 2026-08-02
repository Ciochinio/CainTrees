// Viewer page: read-only. Loads the committed snapshot and shows it. No API
// key, no crawl settings — everything that needs a key lives on build.html.

import { createView } from './view.js';
import { loadBundled, SNAPSHOT_PATH } from './snapshot.js';

const view = createView();

window.__ytreeReady = true;

loadBundled()
  .then((snapshot) => {
    if (!snapshot) {
      view.showEmpty(
        `No data file yet. Open the Build page, run a crawl with your API key, export the JSON, and commit it as ${SNAPSHOT_PATH.replace('./', '')}.`,
      );
      view.setStatus('');
      return;
    }
    const when = snapshot.generatedAt ? new Date(snapshot.generatedAt) : null;
    const stamp = when && !Number.isNaN(when.valueOf()) ? when.toLocaleDateString() : 'unknown date';
    view.adopt(snapshot, `snapshot ${stamp}`);
  })
  .catch((err) => {
    view.showEmpty('The data file could not be read.');
    view.showError(`Snapshot failed to load: ${err.message}`);
  });
