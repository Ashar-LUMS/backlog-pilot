const app = require('./app');
const { initDatabase } = require('./db');

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server.', error);
    process.exit(1);
  }
}

start();
