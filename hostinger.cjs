// Hostinger loads the entry point with require(). The server uses async ESM.
import('./server.js').catch((error) => {
  console.error(error);
  process.exit(1);
});
