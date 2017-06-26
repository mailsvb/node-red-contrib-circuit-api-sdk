 
module.exports = (RED) => {
    const util = require('util');
    const CircuitAPISDK = require('circuit-api-sdk');
    
    // handle the connection to the circuit server
    function CircuitApiSdkServerNode(n) {
        RED.nodes.createNode(this,n);
        let node = this;
        node.client = false;
        node.domain = n.domain;
        node.clientid = n.clientid;
        node.clientsecret = n.clientsecret;
        node.username = n.username;
        node.password = n.password;
        node.setName = n.setName || false;
        node.firstname = n.firstname || '';
        node.lastname = n.lastname || '';
        node.setPresence = n.setPresence || false;
        node.longitude = n.longitude || '';
        node.latitude = n.latitude || '';
        node.location = n.location || '';
        node.status = n.status || '';
        node.connected = false;
        node.state = "Disconnected";
        node.reconnectCount = 0;
        node.subscriptions = {};
        
        if (!node.client) {
            if ((typeof node.clientid === 'undefined' || node.clientid === '') && (typeof node.clientsecret === 'undefined' || node.clientsecret === '')) {
                node.log('login using username/password');
                node.client = new CircuitAPISDK({server:node.domain,username:node.username,password:node.password});
            }
            else {
                node.log('login using client credentials');
                node.client = new CircuitAPISDK({server:node.domain,client_id:node.clientid,client_secret:node.clientsecret});
            }
        }
        
        node.logon = () => {
            node.log('node.logon()');
            if (node.connected === false) {
                node.client.login()
                .then((user) => {
                    node.userId = user.userId;
                    node.userFirstName = user.firstName;
                    node.userLastName = user.lastName;
                    node.log('user ' + node.userFirstName + ' ' + node.userLastName + ' logged on at domain ' + node.domain);
                    node.stateHandler(true);
                })
                .catch((err) => {
                    node.error(util.inspect(err, { showHidden: true, depth: null }));
                    node.warn('Logon failed. retrying 30 seconds >' + node.domain + '<');
                    setTimeout(() => {
                        (node && node.logon) ? node.logon() : node.error('node.logon() does not exist. Logon failed. Aborting');
                    },30000);
                    node.stateHandler(false);
                });
            }
        };
        
        node.updateUser = () => {
            if (node.setPresence) {
                // subscribe to presence changes on own user id
                node.client.subscribePresence([node.userId])
                .catch((err) => node.error(util.inspect(err, { showHidden: true, depth: null })));
                
                // set presence state
                let presence = {};
                presence.state='AVAILABLE';
                if (node.longitude != '') {
                    presence.longitude = node.longitude;
                }
                if (node.latitude != '') {
                    presence.latitude = node.latitude;
                }
                if (node.location != '') {
                    presence.location = node.location;
                }
                if (node.status != '') {
                    presence.status = node.status;
                }
                
                node.client.setPresence(presence)
                .catch((err) => node.error(util.inspect(err, { showHidden: true, depth: null })));
            }
            
            // set firstname, lastname
            if (node.setName) {
                let userObj = {};
                if (node.firstname != node.userFirstName) {
                    userObj.firstName = node.firstname;
                }
                if (node.lastname != node.userLastName) {
                    userObj.lastName = node.lastname;
                }
                if (Object.keys(userObj).length > 0) {
                    userObj.userId = node.userId;
                    node.client.updateUser(userObj)
                    .catch((err) => node.error(util.inspect(err, { showHidden: true, depth: null })));
                }
            }
        };
        
        node.stateHandler = (con) => {
            node.connected = con;
            if (node.connected) {
                node.state = 'Connected';
                node.updateUser();
            } else {
                node.state = 'Disconnected';
            }
            node.broadcast('state', node.state);
        };
        
        node.client.on('log', node.log);
        node.client.on('error', node.error);
        node.client.on('reconnection', () => node.stateHandler(true));
        node.client.on('disconnection', () => node.stateHandler(false));
        node.client.on('itemAdded', (d) => {
            node.broadcast('itemAdded', d);
        });
        node.client.on('itemUpdated', (d) => {
            node.broadcast('itemUpdated', d);
        });
        node.client.on('itemRead', (d) => {
            node.broadcast('itemRead', d);
        });
        node.client.on('presence', (d) => {
            if (d.newState.userId == node.userId) {
                node.updateUser();
            }
            node.broadcast('presence', d);
        });
        node.client.on('activityCreated', (d) => {
            node.broadcast('activityCreated', d);
        });
        node.client.on('activityRead', (d) => {
            node.broadcast('activityRead', d);
        });
        
        // subscribe and unsubscribe handling
        node.subscribe = (id, type, cb) => {
            node.log('receive subscribe for >' + type + '< from >' + id + '<');
            node.subscriptions[id] = node.subscriptions[id] || {};
            node.subscriptions[id][type] = cb;
            if (type == 'state') {
                node.broadcast('state', node.state);
            }
        };
        node.unsubscribe = (id, type) => {
            if (node.subscriptions[id].hasOwnProperty(type)) {
                delete node.subscriptions[id][type];
            }
            if (Object.keys(node.subscriptions[id]).length === 0 || type === '') {
                delete node.subscriptions[id];
            }
        };
        // broadcast events to subscribed nodes
        node.broadcast = (type, data) => {
            node.log('broadcasting ' + data.length + ' to all >' + type + '< listeners');
            for (var s in node.subscriptions) {
                if (node.subscriptions[s].hasOwnProperty(type)) {
                    node.log('listener for >' + type + '< at node >' + s + '<');
                    node.subscriptions[s][type](data);
                }
            }
        };
        
        node.logon();
        
        this.on('close', () => {
            node.log('log out from domain: ' + node.domain);
            node.client.exit();
            delete node.client;
            node.client = false;
        });
    }
    RED.nodes.registerType("circuit-api-sdk-server",CircuitApiSdkServerNode);
    
    //handle outgoing text messages to circuit
    function CircuitApiSdkAddTextItem(n) {
        RED.nodes.createNode(this,n);
        let node = this;
        node.conv = n.conv;
        node.server = RED.nodes.getNode(n.server);
        
        node.server.subscribe(node.id, 'state', (state) => {
            node.status({fill:(state == 'Connected') ? 'green' : 'red',shape:'dot',text:state});
        });
        
        node.on('input', (msg) => {
            if(node.server.connected) {
                node.server.client.addText(((msg.conv) ? msg.conv : node.conv), msg.payload)
                .then((item) => {
                    node.log('message sent');
                    msg.payload = item;
                    node.send(msg);
                })
                .catch((err) => {
                    node.error(util.inspect(err, { showHidden: true, depth: null }));
                    msg.payload = err;
                    node.send(msg);
                });
            }
            else {
                node.error('not connected to server');
            }
        });
        
        node.on('close', () => {
            node.server.unsubscribe(node.id, 'state');
            node.send({ payload: {state: 'stopping'} });
        });
    }
    RED.nodes.registerType("circuit-api-sdk-addText",CircuitApiSdkAddTextItem);
    
    //incoming circuit events
    function CircuitApiSdkEvents(n) {
        RED.nodes.createNode(this,n);
        let node = this;
        node.server = RED.nodes.getNode(n.server);
        //node.convEvent        = n.convEvent;
        node.itemAddedEvent   = n.itemAddedEvent;
        node.itemUpdatedEvent = n.itemUpdatedEvent;
        node.itemReadEvent    = n.itemReadEvent;
        node.presenceEvent = n.presenceEvent;
        node.activityEvent = n.activityEvent;
        
        node.server.subscribe(node.id, 'state', (state) => {
            node.status({fill:(state == 'Connected') ? 'green' : 'red',shape:'dot',text:state});
        });

        /*
        if (node.convEvent) {
            node.server.subscribe(node.id, 'conversationUpdated', (evt) => { node.send({ payload: evt }); });
            node.server.subscribe(node.id, 'conversationCreated', (evt) => { node.send({ payload: evt }); });
        }
        */
        if (node.itemAddedEvent) {
            node.server.subscribe(node.id, 'itemAdded',       (evt) => { node.send({ payload: evt }); });
        }
        if (node.itemUpdatedEvent) {
            node.server.subscribe(node.id, 'itemUpdated',     (evt) => { node.send({ payload: evt }); });
        }
        if (node.itemReadEvent) {
            node.server.subscribe(node.id, 'itemRead',        (evt) => { node.send({ payload: evt }); });
        }
        if (node.presenceEvent) {
            node.server.subscribe(node.id, 'presence',        (evt) => { node.send({ payload: evt }); });
        }
        if (node.activityEvent) {
            node.server.subscribe(node.id, 'activityCreated', (evt) => { node.send({ payload: evt }); });
            node.server.subscribe(node.id, 'activityRead',    (evt) => { node.send({ payload: evt }); });
        }
        
        node.on('close', () => {
            node.server.unsubscribe(node.id, '');
            node.send({ payload: {state: 'stopping'} });
        });
    }
    RED.nodes.registerType("circuit-api-sdk-events",CircuitApiSdkEvents);
    
    //get a conversation by ID
    function CircuitApiSdkGetConvById(n) {
        RED.nodes.createNode(this,n);
        let node = this;
        node.server = RED.nodes.getNode(n.server);
        
        node.server.subscribe(node.id, 'state', (state) => {
            node.status({fill:(state == 'Connected') ? 'green' : 'red',shape:'dot',text:state});
        });
        
        node.on('input', (msg) => {
            if(node.server.connected) {
                node.server.client.getConversationById(msg.payload)
                .then((conv) => {
                    msg.payload = conv;
                    node.send(msg);
                })
                .catch((err) => {
                    node.error(util.inspect(err, { showHidden: true, depth: null }));
                    msg.payload = err;
                    node.send(msg);
                });
            }
            else {
                node.error('not connected to server');
            }
        });
        
        node.on('close', () => {
            node.server.unsubscribe(node.id, 'state');
            node.send({ payload: {state: 'stopping'} });
        });
    }
    RED.nodes.registerType("circuit-api-sdk-get-conv-by-id",CircuitApiSdkGetConvById);
    
    /*
    //getConversationItems 
    function CircuitApiSdkGetConvItems(n) {
        RED.nodes.createNode(this,n);
        let node = this;
        node.server = RED.nodes.getNode(n.server);
        
        node.server.subscribe(node.id, 'state', (state) => {
            node.status({fill:(state == 'Connected') ? 'green' : 'red',shape:'dot',text:state});
        });
        
        node.on('input', (msg) => {
            if(node.server.connected) {
                node.server.client.getConversationItems(node.conv, msg.payload)
                .then((items) => {
                    node.log('getConversationItems returned ' + items.length + ' items');
                    msg.payload = items;
                    node.send(msg);
                })
                .catch((err) => {
                    node.error(util.inspect(err, { showHidden: true, depth: null }));
                    msg.payload = err;
                    node.send(msg);
                });
            }
            else {
                node.error('not connected to server');
            }
        });
        
        node.on('close', () => {
            node.server.unsubscribe(node.id, 'state');
            node.send({ payload: {state: 'stopping'} });
        });
    }
    RED.nodes.registerType("circuit-api-sdk-get-conv-items",CircuitApiSdkGetConvItems);
    */
};
