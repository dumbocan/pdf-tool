// Synthetic timeout fixture. It intentionally never writes a response.
process.stdin.resume();
setInterval(() => {}, 60_000);
