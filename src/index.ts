import 'dotenv/config';

import { startGateway } from './gateway.js';

startGateway().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start gateway:', error);
  process.exit(1);
});
