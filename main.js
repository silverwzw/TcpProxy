var tcpproxy   = require("./server");

var configuration = {
    proxy : {
        local:  { address: "127.0.0.1",    port: 45678 },
        remote: { address: "69.65.19.184", port: 45678 },
        log:    { general: true, client: false, remote: false },
        name:   "game proxy",
    }
};

var server = new tcpproxy.Proxy(configuration.proxy);
server.start();
