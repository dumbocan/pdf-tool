const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const input = Buffer.concat(chunks);
  const request = JSON.parse(input.subarray(4).toString("utf8"));
  const response = Buffer.from(JSON.stringify({ protocolVersion: 1, kind: "extractLocal", requestId: request.requestId, status: "ok", pages: 1 }));
  setTimeout(() => {
    const frame = Buffer.alloc(response.length + 4);
    frame.writeUInt32BE(response.length);
    response.copy(frame, 4);
    process.stdout.write(frame, () => process.exit(0));
  }, 150);
});
