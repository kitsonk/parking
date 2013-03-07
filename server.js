
var loadModule = 'parking-server/main';

dojoConfig = {
	baseUrl: 'src/',
	async: 1,

	hasCache: {
		'host-node': 1,
		'dom': 0
	},

	packages: [{
		name: 'dojo',
		location: 'dojo'
	}, {
		name: 'setten',
		location: 'setten'
	}, {
		name: 'parking-server',
		location: 'parking-server'
	}],

	deps: [loadModule]
};

require('./src/dojo/dojo.js');