 
module.exports = (RED) => {
    const util = require('util');
    const CircuitAPISDK = require('circuit-api-sdk');
    
    // handle the connection to the circuit server
    function CircuitApiSdkServerNode(n) {
        RED.nodes.createNode(this,n);
        let node = this;
        node.domain = n.domain;
        node.clientid = n.clientid;
        node.clientsecret = n.clientsecret;
        node.username = n.username;
        node.password = n.password;
        node.allowFirstname = n.allowFirstname;
        node.firstname = n.firstname;
        node.allowLastname = n.allowLastname;
        node.lastname = n.lastname;
        node.allowStatusMsg = n.allowStatusMsg;
        node.statusMsg = n.statusMsg;
        node.connected = false;
        node.state = "Disconnected";
        node.reconnectCount = 0;
        node.subscriptions = {};
        node.user = null;
        
        if (!node.client) {
            if ((typeof node.clientid === 'undefined' || node.clientid == '') && (typeof node.clientsecret === 'undefined' || node.clientsecret == '')) {
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
                    node.connected = true;
                    node.user = user;
                    node.state = 'Connected'
                    node.log('user ' + node.clientid + ' logged on at domain ' + node.domain);
                    node.broadcast('state', node.state);
                    //node.updateUser();
                })
                .catch((err) => {
                    node.connected = false;
                    node.error(util.inspect(err, { showHidden: true, depth: null }));
                    node.warn('Logon failed. retrying 30 seconds >' + node.clientid + '< >' + node.domain + '<');
                    setTimeout(() => {
                        (node && node.logon) ? node.logon() : node.error('node.logon() does not exist. Logon failed. Aborting');
                    },30000);
                });
            }
        };
        
        /*
        node.updateUser = () => {
            // set presence state to AVAILABLE
            node.client.setPresence({state: Circuit.Constants.PresenceState.AVAILABLE})
            .then(() => node.log('set presence state to ' + Circuit.Constants.PresenceState.AVAILABLE))
            .catch((err) => node.error(util.inspect(err, { showHidden: true, depth: null })));
            // set firstname, lastname if enabled
            let userObj = {};
            if (node.allowFirstname && node.firstname != node.user.firstName) {
                userObj.firstName = node.firstname;
            }
            if (node.allowLastname && node.lastname != node.user.lastName) {
                userObj.lastName = node.lastname;
            }
            if (Object.keys(userObj).length > 0) {
                userObj.userId = node.user.userId;
                node.client.updateUser(userObj)
                .then(() => node.log('updated user data: ' + util.inspect(userObj, { showHidden: true, depth: null })))
                .catch((err) => node.error(util.inspect(err, { showHidden: true, depth: null })));
            }
            // set status message if enabled
            if (node.allowStatusMsg) {
                node.client.setStatusMessage(node.statusMsg)
                .then(() => node.log('Status message set: ' + node.statusMsg))
                .catch((err) => node.error(util.inspect(err, { showHidden: true, depth: null })));
            }
        };
        */
        
        node.client.on('log', node.log);
        node.client.on('error', node.error);
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
            node.log('broadcasting to all >' + type + '< listeners:\n' + util.inspect(data, { showHidden: true, depth: null }));
            for (var s in node.subscriptions) {
                if (node.subscriptions[s].hasOwnProperty(type)) {
                    node.log('listener for >' + type + '< at node >' + s + '<');
                    node.subscriptions[s][type](data);
                }
            }
        };
        
        node.logon();
        
        this.on('close', () => {
            node.log('log out ' + node.clientid + ' from domain: ' + node.domain);
            node.client.exit();
            delete node.client;
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
        //node.convEvent     = n.convEvent;
        node.itemEvent     = n.itemEvent;
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
        if (node.itemEvent) {
            node.server.subscribe(node.id, 'itemAdded',       (evt) => { node.send({ payload: evt }); });
            node.server.subscribe(node.id, 'itemUpdated',     (evt) => { node.send({ payload: evt }); });
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
    
    /*
    //getConversationItems 
    function getConversationItems(n) {
        RED.nodes.createNode(this,n);
        let node = this;
        node.conv = n.conv || "";
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
    RED.nodes.registerType("getConversationItems",getConversationItems);
    */
};
