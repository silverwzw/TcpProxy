var net = require('net');
var def = require('./defaultValue');

/*
    local:  { port: 45678,  address: "127.0.0.1"    },
    remote: { port: 45678,  address: "69.65.19.184"},
    log:    { general: true, client: true, remote: false, formatter: undefined },
    name:   "Rogue's Tale MITM",
*/

/*
    onDataClientToProxy
    onDataRemoteToProxy
    onEndClientToProxy
    onEndRemoteToProxy
    onClose
 */
/*
   start
   isStarted
   getConfig
   sendDataToProxyFromClient
   sendDataToProxyFromRemote
   sendDataFromProxyToClient
   sendDataFromProxyToRemote
 */

var defaultFormatter = buffer => buffer.toString();

var g_currId = 0;
function getId() {
    g_currId = (g_currId + 1) % 10000;
    return g_currId === 0 ? 9999 : g_currId - 1;
};

function getConfig(config) {

    if (def.hasValue("number", config, "local", "port")) {
        throw new Error("Must specify a local listening port.");
    }

    if (def.hasValue("string", config, "remote", "address")) {
        throw new Error("Must specify a remote forwarding address.");
    }

    if (def.hasValue("number", config, "remote", "port")) {
        throw new Error("Must specify a remote forwarding port.");
    }

    return {
        name:  def.value("string", "Proxy", config, "name"),
        log: {
            formatter: def.value("function", defaultFormatter,
                                 config, "log", "formatter"),
            general:   def.value("boolean", true, config, "log", "general"),
            remote:    def.value("boolean", true, config, "log", "remote"),
            client:    def.value("boolean", true, config, "log", "client"),
        },
        local: {
            address: def.value("string", "127.0.0.1",
                               config, "local", "address"),
            port:    config.local.port,
        },
        remote: {
            address: config.remote.address,
            port:    config.local.port,
        }
    };
}

function getPlugin(Plugin, connection) {

    var plugin;

    if (Plugin === undefined) {
        plugin = {};
    }
    else if ("function" === typeof Plugin) {
        const source = "plugin";
        let handler = {
            sendDataToProxyFromClient:
                     data => connection.sendDataToProxyFromClient(data, source),
            sendDataToProxyFromRemote:
                     data => connection.sendDataToProxyFromRemote(data, source),
            sendDataToRemoteFromProxy:
                     data => connection.sendDataToRemoteFromProxy(data),
            sendDataToClientFromProxy:
                     data => connection.sendDataToClientFromProxy(data),
            sendEndToRemoteFromProxy:
                              () => connection.sendEndToRemoteFromProxy(),
            sendEndToClientFromProxy:
                              () => connection.sendEndToClientFromProxy(),
            sendEndToProxyFromRemote:
                              () => connection.sendEndToProxyFromRemote(source),
            sendEndToProxyFromClient:
                              () => connection.sendEndToProxyFromClient(source),
            isProxyToRemoteOpen: () => connection.remoteP !== undefined
        };
        plugin = new Plugin(handler);
    }
    else {
        throw new Error("Invalid tcpproxy plugin");
    }

    var pluginAgent = {};

    function resolveMethod(methodName, defaultImpl) {
        if ("function" === typeof plugin[methodName]) {
             pluginAgent[methodName] = plugin[methodName].bind(plugin);
        }
        else {
            pluginAgent[methodName] = defaultImpl;
        }
    }

    resolveMethod("onDataClientToProxy",
                  data => connection.sendDataToRemoteFromProxy(data));
    resolveMethod("onDataRemoteToProxy",
                  data => connection.sendDataToClientFromProxy(data));
    resolveMethod("onEndClientToProxy",
                  () => connection.sendEndToRemoteFromProxy());
    resolveMethod("onEndRemoteToProxy",
                  () => connection.sendEndToClientFromProxy());
    resolveMethod("onClose", () => undefined);

    return pluginAgent;
}

function Connection(config, Plugin, client, onDistory) {

    this.id         = getId();
    this.plugin     = undefined;
    this.remoteP    = undefined;
    this.clientP    = undefined;

    function tryRemoveConnection() {

        if (this.remoteP !== undefined || this.clientP !== undefined) {
            return false;
        }

        this.plugin.onClose(false);

        if (config.log.general) {
            console.log("..... connection " + this.id + " closed.");
        }

        if (undefined !== onDistory) {
            onDistory(this);
        }

        return true;
    }

    this.shutdown = function () {

        if (config.log.general) {
            console.log("..... connection " + this.id + ": force shutdown.");
        }

        var closeSocket = socket => socket.end();
        if (this.remoteP !== undefined) {
            this.remoteP.then(closeSocket);
        }
        if (this.clientP !== undefined) {
            this.clientP.then(closeSocket);
        }

        this.plugin.onClose(true);

        if (undefined !== onDistory) {
            onDistory(this);
        }
    };

    this.sendEndToClientFromProxy = function() {

        this.clientP.then(client => client.end());
        this.clientP = undefined;
        if (config.log.general) {
            console.log("..... connection " + this.id +
                        " client closed by proxy.");
        }
        tryRemoveConnection.call(this);
    }

    this.sendEndToRemoteFromProxy = function() {

        if (this.remoteP === undefined) {
            // it could be that client connect to proxy but never send data to
            // remote. in such case proxy to remote connection never gets
            // initiated
            console.error("Warning: closing remote connection that has never " +
                          " been established. connection id = " + this.id);
            return;
        }

        this.remoteP.then(remote => remote.end());
        this.remoteP = undefined;

        if (config.log.general) {
            console.log("..... connection " + this.id +
                        " remote closed by proxy.");
        }

        tryRemoveConnection.call(this);
    }

    this.sendEndToProxyFromClient = function(source) {

        if (config.log.general) {
            console.log("..... connection " + this.id +
                        " client closed by client.");
        }

        this.plugin.onEndClientToProxy(source);
    }

    this.sendEndToProxyFromRemote = function(source) {

        if (config.log.general) {
            console.log("..... connection " + this.id +
                        " remote closed by remote.");
        }

        this.plugin.onEndRemoteToProxy(source);
    }

    this.sendDataToProxyFromClient = function(data, source) {

        if (config.log.client) {
            console.log(">>>   " + this.id + " " + config.log.formatter(data));
        }

        this.plugin.onDataClientToProxy(data, source);
    };

    this.sendDataToProxyFromRemote = function(data, source) {

        if (config.log.remote) {
            console.log("  <<< " + this.id + " " + config.log.formatter(data));
        }

        this.plugin.onDataRemoteToProxy(data, source);
    };

    this.sendDataToClientFromProxy = function(data) {

        if (config.log.client) {
            console.log("<<<   " + this.id + " " + config.log.formatter(data));
        }

        if (this.clientP === undefined) {
            throw new Error("Client already closed. connection id: " + this.id);
        }

        this.clientP.then(client => client.write(data));
    };

    function setRemoteP() {
        this.remoteP = new Promise(resolve => {
            var remote = new net.Socket();
            remote.connect(config.remote.port,
                           config.remote.address,
                           () => {
                if (config.log.general) {
                    console.log("..... connection " + this.id +
                                ": Remote connected.");
                }
                remote.on("data",
                          data => this.sendDataToProxyFromRemote(data,
                                                                 "network"));
                remote.on("end",
                          () => this.sendEndToProxyFromRemote("network"));
                resolve(remote);
            });
        });
    }

    this.sendDataToRemoteFromProxy = function(data) {

        if (config.log.remote) {
            console.log("  >>> " + this.id + " " + config.log.formatter(data));
        }

        if (this.remoteP === undefined) {
            setRemoteP.call(this);
        }

        this.remoteP.then(remote => remote.write(data));
    };

    this.clientP = new Promise(resolve => {
        if (config.log.general) {
            console.log("..... connection " + this.id +
                        ": Client connected.");
        }
        client.on("data",
                  data => this.sendDataToProxyFromClient(data, "network"));
        client.on("end",  () => this.sendEndToProxyFromClient("network"));
        resolve(client);
    });

    // `getPlugin` must be called last, otherwise we're passing an `this` object
    // that hasn't fully constructed to the function.
    this.plugin = getPlugin(Plugin, this);
}

function Proxy(config, Plugin) {

    var context = {
        started:     false,
        connections: [],
        server:      undefined,
        config:      getConfig(config),
        Plugin:      Plugin,
    };

    this.isStarted = function () {
        return context.started;
    };

    this.getConfig = function () {
        return config;
    };

    this.start = function () {

        if (context.started) {
            throw new Error("Proxy already started!");
        }
        else {
            context.started = true;
        }

        if (context.config.log.general) {
            console.log("..... Starting " + context.config.name +
                        "  on port: " + context.config.local.port);
            console.log("      remote: " + context.config.remote.address + ":" +
                        context.config.remote.port);
            console.log("      show client log: " + context.config.log.client);
            console.log("      show remote log: " + context.config.log.remote);
        }

        context.server = net.createServer(client => {
            var onDistoryHandler = c => {
                var index = context.connections.indexOf(c);
                context.connections.splice(index, 1);
            };
            var connection = new Connection(context.config,
                                            context.Plugin,
                                            client,
                                            onDistoryHandler);
            context.connections.push(connection);
        });

        context.server.listen(context.config.local.port,
                              context.config.local.address,
                              511,
                              () => {
            if (context.config.log.general) {
                console.log("..... Listening");
            }
        });
    };

    this.shutdown = function () {

        if (context.config.general) {
            console.log("..... Received shutdown request for " +
                        context.config.name);
        }

        // save a list of current connections
        var connections = Array.prototype.slice.call(context.connections);
        for (connection of connections) {
            connection.shutdown();
        }

        return this.close();
    };

    this.close = function () {

        if (context.config.general) {
            console.log("..... Closing " + context.config.name);
        }

        context.isStarted   = false;
        context.connections = [];

        return new Promise(context.server.close.bind(context.server)).then(
            () => {
                if (context.config.general) {
                    console.log("..... " + context.config.name + " closed");
                }
            }
        );
    };
};

exports.Proxy = Proxy;
