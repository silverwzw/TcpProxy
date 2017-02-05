var net = require('net');

var configuration = {
  local:  { port: 45678,  address: "127.0.0.1"    },
  remote: { port: 45678,  address: "69.65.19.184" },
  log:    { client: true, remote: false }
};

var escapes = [ { from: /&lt;/g,    to: "<"  },
                { from: /&gt;/g,    to: ">"  },
                { from: /&quot;/g,  to: "\"" },
                { from: /&equal;/g, to: "="  } ];

var msgIdRegexp = /&lt;msg id&equal;&quot;([^&]*)&quot;/;

var escaper = str => escapes.reduce((s, e) => s.replace(e.from, e.to), str);

function messageDisplayer(msg) {
    var str = msg.toString();
    return escaper(str);
}

function clientDataReceived(context, data) {
    context.sendToRemote(data);
}

function remoteDataReceived(context, data) {
    context.sendToClient(data);
}

function isPing(data) {
    return data.toString() === '&&lt;msg id&equal;&quot;ping&quot;/&gt;';
}

console.log("...... Starting Rogue's Tale MITM server on port: " +
            configuration.local.port);
console.log("       remote: " + configuration.remote.address + ":" +
configuration.remote.port);
console.log("       show client log: " + configuration.log.client);
console.log("       show remote log: " + configuration.log.remote);

var clientP = new Promise(resolve => {
    var listening = false;
    var client;

    var server = net.createServer(socket => {
                                      client = socket;
                                      if (listening) {
                                         console.log("...... Listening");
                                         resolve(client);
                                      }
                                  });

    server.listen(configuration.local.port, configuration.local.address, 511,
                  () => {
                      listening = true;
                      if (client !== undefined) {
                          console.log("...... Listening");
                          resolve(client);
                      }
                  });
});

var remoteP = new Promise(resolve => {
    var remote = new net.Socket();
    remote.connect(configuration.remote.port,
                   configuration.remote.address,
                   () => { console.log("...... Remote connected.");
                           resolve(remote) }
    );
});

var ioreadyP = Promise.all([clientP, remoteP]);

ioreadyP.then(io => {

    var context = {
        client:       io[0],
        remote:       io[1],
        sendToClient: undefined,
        sendToRemote: undefined,
    };

    context.sendToClient = data => {
        if (configuration.log.client && !isPing(data)) {
            console.log("<<<   " + messageDisplayer(data));
        }
        context.client.write(data);
    };

    context.sendToRemote = data => {
        if (configuration.log.remote && !isPing(data)) {
            console.log("  >>> " + messageDisplayer(data));
        }
        context.remote.write(data);
    };

    context.client.on("data", data => {
        if (configuration.log.client && !isPing(data)) {
            console.log(">>>   " + messageDisplayer(data));
        }
        clientDataReceived(context, data);
    });

    context.remote.on("data", data => {
        if (configuration.log.remote && !isPing(data)) {
            console.log(">>>   " + messageDisplayer(data));
        }
        remoteDataReceived(context, data);
    });
});
