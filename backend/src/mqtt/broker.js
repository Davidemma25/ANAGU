import net from 'node:net';
import { Aedes } from 'aedes';

let brokerInstance = null;
let tcpServer = null;
let activePort = null;
let startedAt = null;
let publishedCount = 0;

function parseConfiguredPort() {
  const raw = process.env.MQTT_BROKER_PORT;
  if (raw !== undefined && raw !== '') {
    return Number(raw);
  }
  return 1883;
}

function listenServer(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

export async function startMqttBroker({ port, host = '127.0.0.1' } = {}) {
  if (brokerInstance && tcpServer && tcpServer.listening) {
    return {
      running: true,
      host,
      port: activePort,
      brokerUrl: `mqtt://${host}:${activePort}`,
    };
  }

  const broker = await Aedes.createBroker();
  const server = net.createServer(broker.handle);

  broker.on('publish', (packet) => {
    if (packet.topic && !packet.topic.startsWith('$SYS/')) {
      publishedCount += 1;
    }
  });

  const targetPort = port !== undefined ? Number(port) : parseConfiguredPort();

  try {
    activePort = await listenServer(server, targetPort, host);
  } catch (err) {
    // If default 1883 is already bound (e.g., external Mosquitto or concurrent run), bind an ephemeral port cleanly
    if (err.code === 'EADDRINUSE' && port === undefined) {
      activePort = await listenServer(server, 0, host);
    } else {
      await broker.close();
      throw err;
    }
  }

  brokerInstance = broker;
  tcpServer = server;
  startedAt = new Date().toISOString();

  return {
    running: true,
    host,
    port: activePort,
    brokerUrl: `mqtt://${host}:${activePort}`,
  };
}

export async function stopMqttBroker() {
  if (tcpServer) {
    await new Promise((resolve) => {
      tcpServer.close(() => resolve());
    });
    tcpServer = null;
  }
  if (brokerInstance) {
    await new Promise((resolve) => {
      brokerInstance.close(() => resolve());
    });
    brokerInstance = null;
  }
  activePort = null;
  startedAt = null;
}

export function getMqttBrokerStatus() {
  return {
    running: Boolean(brokerInstance && tcpServer && tcpServer.listening),
    port: activePort,
    brokerUrl: activePort ? `mqtt://127.0.0.1:${activePort}` : null,
    connectedClients: brokerInstance ? brokerInstance.connectedClients : 0,
    publishedPacketCount: publishedCount,
    startedAt,
  };
}
