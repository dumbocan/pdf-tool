// Test-only preload: blocks all outbound socket connections to prove
// the extraction adapter is fully deterministic and network-free.
// Loaded via: node --import test/fixtures/network-deny.mjs src/engine-stdio.js
import net from "node:net";
import http from "node:http";
import https from "node:https";

const MSG = "network: outbound sockets blocked by test fixture";
const blocked = () => { throw Object.assign(new Error(MSG), { code: "ENETBLOCKED" }); };

// Block connection factories
net.connect = blocked;
net.createConnection = blocked;
http.request = blocked;
http.get = blocked;
https.request = blocked;
https.get = blocked;

// Block Socket.prototype.connect (the lowest-level connect path)
net.Socket.prototype.connect = function () {
  throw Object.assign(new Error(MSG), { code: "ENETBLOCKED" });
};
