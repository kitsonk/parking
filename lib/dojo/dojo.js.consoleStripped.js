(function(
	userConfig,
	defaultConfig
){
	// summary:
	//		This is the "source loader" and is the entry point for Dojo during development. You may also load Dojo with
	//		any AMD-compliant loader via the package main module dojo/main.
	// description:
	//		This is the "source loader" for Dojo. It provides an AMD-compliant loader that can be configured
	//		to operate in either synchronous or asynchronous modes. After the loader is defined, dojo is loaded
	//		IAW the package main module dojo/main. In the event you wish to use a foreign loader, you may load dojo as a package
	//		via the package main module dojo/main and this loader is not required; see dojo/package.json for details.
	//
	//		In order to keep compatibility with the v1.x line, this loader includes additional machinery that enables
	//		the dojo.provide, dojo.require et al API. This machinery is loaded by default, but may be dynamically removed
	//		via the has.js API and statically removed via the build system.
	//
	//		This loader includes sniffing machinery to determine the environment; the following environments are supported:
	//
	//		- browser
	//		- node.js
	//		- rhino
	//
	//		This is the so-called "source loader". As such, it includes many optional features that may be discadred by
	//		building a customized verion with the build system.

	// Design and Implementation Notes
	//
	// This is a dojo-specific adaption of bdLoad, donated to the dojo foundation by Altoviso LLC.
	//
	// This function defines an AMD-compliant (http://wiki.commonjs.org/wiki/Modules/AsynchronousDefinition)
	// loader that can be configured to operate in either synchronous or asynchronous modes.
	//
	// Since this machinery implements a loader, it does not have the luxury of using a load system and/or
	// leveraging a utility library. This results in an unpleasantly long file; here is a road map of the contents:
	//
	//	 1. Small library for use implementing the loader.
	//	 2. Define the has.js API; this is used throughout the loader to bracket features.
	//	 3. Define the node.js and rhino sniffs and sniff.
	//	 4. Define the loader's data.
	//	 5. Define the configuration machinery.
	//	 6. Define the script element sniffing machinery and sniff for configuration data.
	//	 7. Configure the loader IAW the provided user, default, and sniffing data.
	//	 8. Define the global require function.
	//	 9. Define the module resolution machinery.
	//	10. Define the module and plugin module definition machinery
	//	11. Define the script injection machinery.
	//	12. Define the window load detection.
	//	13. Define the logging API.
	//	14. Define the tracing API.
	//	16. Define the AMD define function.
	//	17. Define the dojo v1.x provide/require machinery--so called "legacy" modes.
	//	18. Publish global variables.
	//
	// Language and Acronyms and Idioms
	//
	// moduleId: a CJS module identifier, (used for public APIs)
	// mid: moduleId (used internally)
	// packageId: a package identifier (used for public APIs)
	// pid: packageId (used internally); the implied system or default package has pid===""
	// pack: package is used internally to reference a package object (since javascript has reserved words including "package")
	// prid: plugin resource identifier
	// The integer constant 1 is used in place of true and 0 in place of false.

	// define a minimal library to help build the loader
	var	noop = function(){
		},

		isEmpty = function(it){
			for(var p in it){
				return 0;
			}
			return 1;
		},

		toString = {}.toString,

		isFunction = function(it){
			return toString.call(it) == "[object Function]";
		},

		isString = function(it){
			return toString.call(it) == "[object String]";
		},

		isArray = function(it){
			return toString.call(it) == "[object Array]";
		},

		forEach = function(vector, callback){
			if(vector){
				for(var i = 0; i < vector.length;){
					callback(vector[i++]);
				}
			}
		},

		mix = function(dest, src){
			for(var p in src){
				dest[p] = src[p];
			}
			return dest;
		},

		makeError = function(error, info){
			return mix(new Error(error), {src:"dojoLoader", info:info});
		},

		uidSeed = 1,

		uid = function(){
			// Returns a unique indentifier (within the lifetime of the document) of the form /_d+/.
			return "_" + uidSeed++;
		},

		// FIXME: how to doc window.require() api

		// this will be the global require function; define it immediately so we can start hanging things off of it
		req = function(
			config,		  //(object, optional) hash of configuration properties
			dependencies, //(array of commonjs.moduleId, optional) list of modules to be loaded before applying callback
			callback	  //(function, optional) lamda expression to apply to module values implied by dependencies
		){
			return contextRequire(config, dependencies, callback, 0, req);
		},

		// the loader uses the has.js API to control feature inclusion/exclusion; define then use throughout
		global = this,

		doc = global.document,

		element = doc && doc.createElement("DiV"),

		has = req.has = function(name){
			return isFunction(hasCache[name]) ? (hasCache[name] = hasCache[name](global, doc, element)) : hasCache[name];
		},

		hasCache = has.cache = defaultConfig.hasCache;

	has.add = function(name, test, now, force){
		(hasCache[name]===undefined || force) && (hasCache[name] = test);
		return now && has(name);
	};

	 0 && has.add("host-node", userConfig.has && "host-node" in userConfig.has ?
		userConfig.has["host-node"] :
		(typeof process == "object" && process.versions && process.versions.node && process.versions.v8));
	if( 0 ){
		// fixup the default config for node.js environment
		require("./_base/configNode.js").config(defaultConfig);
		// remember node's require (with respect to baseUrl==dojo's root)
		defaultConfig.loaderPatch.nodeRequire = require;
	}

	 0 && has.add("host-rhino", userConfig.has && "host-rhino" in userConfig.has ?
		userConfig.has["host-rhino"] :
		(typeof load == "function" && (typeof Packages == "function" || typeof Packages == "object")));
	if( 0 ){
		// owing to rhino's lame feature that hides the source of the script, give the user a way to specify the baseUrl...
		for(var baseUrl = userConfig.baseUrl || ".", arg, rhinoArgs = this.arguments, i = 0; i < rhinoArgs.length;){
			arg = (rhinoArgs[i++] + "").split("=");
			if(arg[0] == "baseUrl"){
				baseUrl = arg[1];
				break;
			}
		}
		load(baseUrl + "/_base/configRhino.js");
		rhinoDojoConfig(defaultConfig, baseUrl, rhinoArgs);
	}

	// userConfig has tests override defaultConfig has tests; do this after the environment detection because
	// the environment detection usually sets some has feature values in the hasCache.
	for(var p in userConfig.has){
		has.add(p, userConfig.has[p], 0, 1);
	}

	//
	// define the loader data
	//

	// the loader will use these like symbols if the loader has the traceApi; otherwise
	// define magic numbers so that modules can be provided as part of defaultConfig
	var	requested = 1,
		arrived = 2,
		nonmodule = 3,
		executing = 4,
		executed = 5;

	if( 0 ){
		// these make debugging nice; but using strings for symbols is a gross rookie error; don't do it for production code
		requested = "requested";
		arrived = "arrived";
		nonmodule = "not-a-module";
		executing = "executing";
		executed = "executed";
	}

	var legacyMode = 0,
		sync = "sync",
		xd = "xd",
		syncExecStack = [],
		dojoRequirePlugin = 0,
		checkDojoRequirePlugin = noop,
		transformToAmd = noop,
		getXhr;
	if( 0 ){
		req.isXdUrl = noop;

		req.initSyncLoader = function(dojoRequirePlugin_, checkDojoRequirePlugin_, transformToAmd_){
			// the first dojo/_base/loader loaded gets to define these variables; they are designed to work
			// in the presense of zero to many mapped dojo/_base/loaders
			if(!dojoRequirePlugin){
				dojoRequirePlugin = dojoRequirePlugin_;
				checkDojoRequirePlugin = checkDojoRequirePlugin_;
				transformToAmd = transformToAmd_;
			}

			return {
				sync:sync,
				requested:requested,
				arrived:arrived,
				nonmodule:nonmodule,
				executing:executing,
				executed:executed,
				syncExecStack:syncExecStack,
				modules:modules,
				execQ:execQ,
				getModule:getModule,
				injectModule:injectModule,
				setArrived:setArrived,
				signal:signal,
				finishExec:finishExec,
				execModule:execModule,
				dojoRequirePlugin:dojoRequirePlugin,
				getLegacyMode:function(){return legacyMode;},
				guardCheckComplete:guardCheckComplete
			};
		};

		if( 1 ){
			// in legacy sync mode, the loader needs a minimal XHR library

			var locationProtocol = location.protocol,
				locationHost = location.host;
			req.isXdUrl = function(url){
				if(/^\./.test(url)){
					// begins with a dot is always relative to page URL; therefore not xdomain
					return false;
				}
				if(/^\/\//.test(url)){
					// for v1.6- backcompat, url starting with // indicates xdomain
					return true;
				}
				// get protocol and host
				// \/+ takes care of the typical file protocol that looks like file:///drive/path/to/file
				// locationHost is falsy if file protocol => if locationProtocol matches and is "file:", || will return false
				var match = url.match(/^([^\/\:]+\:)\/+([^\/]+)/);
				return match && (match[1] != locationProtocol || (locationHost && match[2] != locationHost));
			};


			// note: to get the file:// protocol to work in FF, you must set security.fileuri.strict_origin_policy to false in about:config
			 1 || has.add("dojo-xhr-factory", 1);
			has.add("dojo-force-activex-xhr",  1  && !doc.addEventListener && window.location.protocol == "file:");
			 1 || has.add("native-xhr", typeof XMLHttpRequest != "undefined");
			if( 1  && !has("dojo-force-activex-xhr")){
				getXhr = function(){
					return new XMLHttpRequest();
				};
			}else{
				// if in the browser an old IE; find an xhr
				for(var XMLHTTP_PROGIDS = ['Msxml2.XMLHTTP', 'Microsoft.XMLHTTP', 'Msxml2.XMLHTTP.4.0'], progid, i = 0; i < 3;){
					try{
						progid = XMLHTTP_PROGIDS[i++];
						if(new ActiveXObject(progid)){
							// this progid works; therefore, use it from now on
							break;
						}
					}catch(e){
						// squelch; we're just trying to find a good ActiveX progid
						// if they all fail, then progid ends up as the last attempt and that will signal the error
						// the first time the client actually tries to exec an xhr
					}
				}
				getXhr = function(){
					return new ActiveXObject(progid);
				};
			}
			req.getXhr = getXhr;

			has.add("dojo-gettext-api", 1);
			req.getText = function(url, async, onLoad){
				var xhr = getXhr();
				xhr.open('GET', fixupUrl(url), false);
				xhr.send(null);
				if(xhr.status == 200 || (!location.host && !xhr.status)){
					if(onLoad){
						onLoad(xhr.responseText, async);
					}
				}else{
					throw makeError("xhrFailed", xhr.status);
				}
				return xhr.responseText;
			};
		}
	}else{
		req.async = 1;
	}

	//
	// loader eval
	//
	var eval_ =
		// use the function constructor so our eval is scoped close to (but not in) in the global space with minimal pollution
		new Function('return eval(arguments[0]);');

	req.eval =
		function(text, hint){
			return eval_(text + "\r\n////@ sourceURL=" + hint);
		};

	//
	// loader micro events API
	//
	var listenerQueues = {},
		error = "error",
		signal = req.signal = function(type, args){
			var queue = listenerQueues[type];
			// notice we run a copy of the queue; this allows listeners to add/remove
			// other listeners without affecting this particular signal
			forEach(queue && queue.slice(0), function(listener){
				listener.apply(null, isArray(args) ? args : [args]);
			});
		},
		on = req.on = function(type, listener){
			// notice a queue is not created until a client actually connects
			var queue = listenerQueues[type] || (listenerQueues[type] = []);
			queue.push(listener);
			return {
				remove:function(){
					for(var i = 0; i<queue.length; i++){
						if(queue[i]===listener){
							queue.splice(i, 1);
							return;
						}
					}
				}
			};
		};

	// configuration machinery; with an optimized/built defaultConfig, all configuration machinery can be discarded
	// lexical variables hold key loader data structures to help with minification; these may be completely,
	// one-time initialized by defaultConfig for optimized/built versions
	var
		aliases
			// a vector of pairs of [regexs or string, replacement] => (alias, actual)
			= [],

		paths
			// CommonJS paths
			= {},

		pathsMapProg
			// list of (from-path, to-path, regex, length) derived from paths;
			// a "program" to apply paths; see computeMapProg
			= [],

		packs
			// a map from packageId to package configuration object; see fixupPackageInfo
			= {},

		map = req.map
			// AMD map config variable; dojo/_base/kernel needs req.map to figure out the scope map
			= {},

		mapProgs
			// vector of quads as described by computeMapProg; map-key is AMD map key, map-value is AMD map value
			= [],

		modules
			// A hash:(mid) --> (module-object) the module namespace
			//
			// pid: the package identifier to which the module belongs (e.g., "dojo"); "" indicates the system or default package
			// mid: the fully-resolved (i.e., mappings have been applied) module identifier without the package identifier (e.g., "dojo/io/script")
			// url: the URL from which the module was retrieved
			// pack: the package object of the package to which the module belongs
			// executed: 0 => not executed; executing => in the process of tranversing deps and running factory; executed => factory has been executed
			// deps: the dependency vector for this module (vector of modules objects)
			// def: the factory for this module
			// result: the result of the running the factory for this module
			// injected: (0 | requested | arrived) the status of the module; nonmodule means the resource did not call define
			// load: plugin load function; applicable only for plugins
			//
			// Modules go through several phases in creation:
			//
			// 1. Requested: some other module's definition or a require application contained the requested module in
			//	  its dependency vector or executing code explicitly demands a module via req.require.
			//
			// 2. Injected: a script element has been appended to the insert-point element demanding the resource implied by the URL
			//
			// 3. Loaded: the resource injected in [2] has been evalated.
			//
			// 4. Defined: the resource contained a define statement that advised the loader about the module. Notice that some
			//	  resources may just contain a bundle of code and never formally define a module via define
			//
			// 5. Evaluated: the module was defined via define and the loader has evaluated the factory and computed a result.
			= {},

		cacheBust
			// query string to append to module URLs to bust browser cache
			= "",

		cache
			// hash:(mid | url)-->(function | string)
			//
			// A cache of resources. The resources arrive via a config.cache object, which is a hash from either mid --> function or
			// url --> string. The url key is distinguished from the mid key by always containing the prefix "url:". url keys as provided
			// by config.cache always have a string value that represents the contents of the resource at the given url. mid keys as provided
			// by configl.cache always have a function value that causes the same code to execute as if the module was script injected.
			//
			// Both kinds of key-value pairs are entered into cache via the function consumePendingCache, which may relocate keys as given
			// by any mappings *iff* the config.cache was received as part of a module resource request.
			//
			// Further, for mid keys, the implied url is computed and the value is entered into that key as well. This allows mapped modules
			// to retrieve cached items that may have arrived consequent to another namespace.
			//
			 = {},

		urlKeyPrefix
			// the prefix to prepend to a URL key in the cache.
			= "url:",

		pendingCacheInsert
			// hash:(mid)-->(function)
			//
			// Gives a set of cache modules pending entry into cache. When cached modules are published to the loader, they are
			// entered into pendingCacheInsert; modules are then pressed into cache upon (1) AMD define or (2) upon receiving another
			// independent set of cached modules. (1) is the usual case, and this case allows normalizing mids given in the pending
			// cache for the local configuration, possibly relocating modules.
			 = {},

		dojoSniffConfig
			// map of configuration variables
			// give the data-dojo-config as sniffed from the document (if any)
			= {};

	if( 1 ){
		var consumePendingCacheInsert = function(referenceModule){
				var p, item, match, now, m;
				for(p in pendingCacheInsert){
					item = pendingCacheInsert[p];
					match = p.match(/^url\:(.+)/);
					if(match){
						cache[urlKeyPrefix + toUrl(match[1], referenceModule)] =  item;
					}else if(p=="*now"){
						now = item;
					}else if(p!="*noref"){
						m = getModuleInfo(p, referenceModule);
						cache[m.mid] = cache[urlKeyPrefix + m.url] = item;
					}
				}
				if(now){
					now(createRequire(referenceModule));
				}
				pendingCacheInsert = {};
			},

			escapeString = function(s){
				return s.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g, function(c){ return "\\" + c; });
			},

			computeMapProg = function(map, dest){
				// This routine takes a map as represented by a JavaScript object and initializes dest, a vector of
				// quads of (map-key, map-value, refex-for-map-key, length-of-map-key), sorted decreasing by length-
				// of-map-key. The regex looks for the map-key followed by either "/" or end-of-string at the beginning
				// of a the search source. Notice the map-value is irrelevent to the algorithm
				dest.splice(0, dest.length);
				for(var p in map){
					dest.push([
						p,
						map[p],
						new RegExp("^" + escapeString(p) + "(\/|$)"),
						p.length]);
				}
				dest.sort(function(lhs, rhs){ return rhs[3] - lhs[3]; });
				return dest;
			},

			fixupPackageInfo = function(packageInfo){
				// calculate the precise (name, location, main, mappings) for a package
				var name = packageInfo.name;
				if(!name){
					// packageInfo must be a string that gives the name
					name = packageInfo;
					packageInfo = {name:name};
				}
				packageInfo = mix({main:"main"}, packageInfo);
				packageInfo.location = packageInfo.location ? packageInfo.location : name;

				// packageMap is depricated in favor of AMD map
				if(packageInfo.packageMap){
					map[name] = packageInfo.packageMap;
				}

				if(!packageInfo.main.indexOf("./")){
					packageInfo.main = packageInfo.main.substring(2);
				}

				// now that we've got a fully-resolved package object, push it into the configuration
				packs[name] = packageInfo;
			},

			delayedModuleConfig
				// module config cannot be consummed until the loader is completely initialized; therefore, all
				// module config detected during booting is memorized and applied at the end of loader initialization
				// TODO: this is a bit of a kludge; all config should be moved to end of loader initialization, but
				// we'll delay this chore and do it with a final loader 1.x cleanup after the 2.x loader prototyping is complete
				= [],


			config = function(config, booting, referenceModule){
				for(var p in config){
					if(p=="waitSeconds"){
						req.waitms = (config[p] || 0) * 1000;
					}
					if(p=="cacheBust"){
						cacheBust = config[p] ? (isString(config[p]) ? config[p] : (new Date()).getTime() + "") : "";
					}
					if(p=="baseUrl" || p=="combo"){
						req[p] = config[p];
					}
					if( 0  && p=="async"){
						// falsy or "sync" => legacy sync loader
						// "xd" => sync but loading xdomain tree and therefore loading asynchronously (not configurable, set automatically by the loader)
						// "legacyAsync" => permanently in "xd" by choice
						// "debugAtAllCosts" => trying to load everything via script injection (not implemented)
						// otherwise, must be truthy => AMD
						// legacyMode: sync | legacyAsync | xd | false
						var mode = config[p];
						req.legacyMode = legacyMode = (isString(mode) && /sync|legacyAsync/.test(mode) ? mode : (!mode ? sync : false));
						req.async = !legacyMode;
					}
					if(config[p]!==hasCache){
						// accumulate raw config info for client apps which can use this to pass their own config
						req.rawConfig[p] = config[p];
						p!="has" && has.add("config-"+p, config[p], 0, booting);
					}
				}

				// make sure baseUrl exists
				if(!req.baseUrl){
					req.baseUrl = "./";
				}
				// make sure baseUrl ends with a slash
				if(!/\/$/.test(req.baseUrl)){
					req.baseUrl += "/";
				}

				// now do the special work for has, packages, packagePaths, paths, aliases, and cache

				for(p in config.has){
					has.add(p, config.has[p], 0, booting);
				}

				// for each package found in any packages config item, augment the packs map owned by the loader
				forEach(config.packages, fixupPackageInfo);

				// for each packagePath found in any packagePaths config item, augment the packageConfig
				// packagePaths is depricated; remove in 2.0
				for(baseUrl in config.packagePaths){
					forEach(config.packagePaths[baseUrl], function(packageInfo){
						var location = baseUrl + "/" + packageInfo;
						if(isString(packageInfo)){
							packageInfo = {name:packageInfo};
						}
						packageInfo.location = location;
						fixupPackageInfo(packageInfo);
					});
				}

				// notice that computeMapProg treats the dest as a reference; therefore, if/when that variable
				// is published (see dojo-publish-privates), the published variable will always hold a valid value.

				// this must come after all package processing since package processing may mutate map
				computeMapProg(mix(map, config.map), mapProgs);
				forEach(mapProgs, function(item){
					item[1] = computeMapProg(item[1], []);
					if(item[0]=="*"){
						mapProgs.star = item;
					}
				});

				// push in any paths and recompute the internal pathmap
				computeMapProg(mix(paths, config.paths), pathsMapProg);

				// aliases
				forEach(config.aliases, function(pair){
					if(isString(pair[0])){
						pair[0] = new RegExp("^" + escapeString(pair[0]) + "$");
					}
					aliases.push(pair);
				});

				if(booting){
					delayedModuleConfig.push({config:config.config});
				}else{
					for(p in config.config){
						var module = getModule(p, referenceModule);
						module.config = mix(module.config || {}, config.config[p]);
					}
				}

				// push in any new cache values
				if(config.cache){
					consumePendingCacheInsert();
					pendingCacheInsert = config.cache;
					if(config.cache["*noref"]){
						consumePendingCacheInsert();
					}
				}

				signal("config", [config, req.rawConfig]);
			};

		//
		// execute the various sniffs; userConfig can override and value
		//

		if( 0  ||  0 ){
			// the sniff regex looks for a src attribute ending in dojo.js, optionally preceeded with a path.
			// match[3] returns the path to dojo.js (if any) without the trailing slash. This is used for the
			// dojo location on CDN deployments and baseUrl when either/both of these are not provided
			// explicitly in the config data; this is the 1.6- behavior.

			var scripts = doc.getElementsByTagName("script"),
				i = 0,
				script, dojoDir, src, match;
			while(i < scripts.length){
				script = scripts[i++];
				if((src = script.getAttribute("src")) && (match = src.match(/(((.*)\/)|^)dojo\.js(\W|$)/i))){
					// sniff dojoDir and baseUrl
					dojoDir = match[3] || "";
					defaultConfig.baseUrl = defaultConfig.baseUrl || dojoDir;

					// sniff configuration on attribute in script element
					src = (script.getAttribute("data-dojo-config") || script.getAttribute("djConfig"));
					if(src){
						dojoSniffConfig = req.eval("({ " + src + " })", "data-dojo-config");
					}

					// sniff requirejs attribute
					if( 0 ){
						var dataMain = script.getAttribute("data-main");
						if(dataMain){
							dojoSniffConfig.deps = dojoSniffConfig.deps || [dataMain];
						}
					}
					break;
				}
			}
		}

		if( 0 ){
			// pass down doh.testConfig from parent as if it were a data-dojo-config
			try{
				if(window.parent != window && window.parent.require){
					var doh = window.parent.require("doh");
					doh && mix(dojoSniffConfig, doh.testConfig);
				}
			}catch(e){}
		}

		// configure the loader; let the user override defaults
		req.rawConfig = {};
		config(defaultConfig, 1);

		// do this before setting userConfig/sniffConfig to allow userConfig/sniff overrides
		if( 0 ){
			packs.dojo.location = dojoDir;
			if(dojoDir){
				dojoDir += "/";
			}
			packs.dijit.location = dojoDir + "../dijit/";
			packs.dojox.location = dojoDir + "../dojox/";
		}

		config(userConfig, 1);
		config(dojoSniffConfig, 1);

	}else{
		// no config API, assume defaultConfig has everything the loader needs...for the entire lifetime of the application
		paths = defaultConfig.paths;
		pathsMapProg = defaultConfig.pathsMapProg;
		packs = defaultConfig.packs;
		aliases = defaultConfig.aliases;
		mapProgs = defaultConfig.mapProgs;
		modules = defaultConfig.modules;
		cache = defaultConfig.cache;
		cacheBust = defaultConfig.cacheBust;

		// remember the default config for other processes (e.g., dojo/config)
		req.rawConfig = defaultConfig;
	}


	if( 0 ){
		req.combo = req.combo || {add:noop};
		var	comboPending = 0,
			combosPending = [],
			comboPendingTimer = null;
	}


	// build the loader machinery iaw configuration, including has feature tests
	var	injectDependencies = function(module){
			// checkComplete!=0 holds the idle signal; we're not idle if we're injecting dependencies
			guardCheckComplete(function(){
				forEach(module.deps, injectModule);
				if( 0  && comboPending && !comboPendingTimer){
					comboPendingTimer = setTimeout(function() {
						comboPending = 0;
						comboPendingTimer = null;
						req.combo.done(function(mids, url) {
							var onLoadCallback= function(){
								// defQ is a vector of module definitions 1-to-1, onto mids
								runDefQ(0, mids);
								checkComplete();
							};
							combosPending.push(mids);
							injectingModule = mids;
							req.injectUrl(url, onLoadCallback, mids);
							injectingModule = 0;
						}, req);
					}, 0);
				}
			});
		},

		contextRequire = function(a1, a2, a3, referenceModule, contextRequire){
			var module, syntheticMid;
			if(isString(a1)){
				// signature is (moduleId)
				module = getModule(a1, referenceModule, true);
				if(module && module.executed){
					return module.result;
				}
				throw makeError("undefinedModule", a1);
			}
			if(!isArray(a1)){
				// a1 is a configuration
				config(a1, 0, referenceModule);

				// juggle args; (a2, a3) may be (dependencies, callback)
				a1 = a2;
				a2 = a3;
			}
			if(isArray(a1)){
				// signature is (requestList [,callback])
				if(!a1.length){
					a2 && a2();
				}else{
					syntheticMid = "require*" + uid();

					// resolve the request list with respect to the reference module
					for(var mid, deps = [], i = 0; i < a1.length;){
						mid = a1[i++];
						deps.push(getModule(mid, referenceModule));
					}

					// construct a synthetic module to control execution of the requestList, and, optionally, callback
					module = mix(makeModuleInfo("", syntheticMid, 0, ""), {
						injected: arrived,
						deps: deps,
						def: a2 || noop,
						require: referenceModule ? referenceModule.require : req,
						gc: 1 //garbage collect
					});
					modules[module.mid] = module;

					// checkComplete!=0 holds the idle signal; we're not idle if we're injecting dependencies
					injectDependencies(module);

					// try to immediately execute
					// if already traversing a factory tree, then strict causes circular dependency to abort the execution; maybe
					// it's possible to execute this require later after the current traversal completes and avoid the circular dependency.
					// ...but *always* insist on immediate in synch mode
					var strict = checkCompleteGuard && legacyMode!=sync;
					guardCheckComplete(function(){
						execModule(module, strict);
					});
					if(!module.executed){
						// some deps weren't on board or circular dependency detected and strict; therefore, push into the execQ
						execQ.push(module);
					}
					checkComplete();
				}
			}
			return contextRequire;
		},

		createRequire = function(module){
			if(!module){
				return req;
			}
			var result = module.require;
			if(!result){
				result = function(a1, a2, a3){
					return contextRequire(a1, a2, a3, module, result);
				};
				module.require = mix(result, req);
				result.module = module;
				result.toUrl = function(name){
					return toUrl(name, module);
				};
				result.toAbsMid = function(mid){
					return toAbsMid(mid, module);
				};
				if( 0 ){
					result.undef = function(mid){
						req.undef(mid, module);
					};
				}
				if( 0 ){
					result.syncLoadNls = function(mid){
						var nlsModuleInfo = getModuleInfo(mid, module),
							nlsModule = modules[nlsModuleInfo.mid];
						if(!nlsModule || !nlsModule.executed){
							cached = cache[nlsModuleInfo.mid] || cache[urlKeyPrefix + nlsModuleInfo.url];
							if(cached){
								evalModuleText(cached);
								nlsModule = modules[nlsModuleInfo.mid];
							}
						}
						return nlsModule && nlsModule.executed && nlsModule.result;
					};
				}

			}
			return result;
		},

		execQ =
			// The list of modules that need to be evaluated.
			[],

		defQ =
			// The queue of define arguments sent to loader.
			[],

		waiting =
			// The set of modules upon which the loader is waiting for definition to arrive
			{},

		setRequested = function(module){
			module.injected = requested;
			waiting[module.mid] = 1;
			if(module.url){
				waiting[module.url] = module.pack || 1;
			}
			startTimer();
		},

		setArrived = function(module){
			module.injected = arrived;
			delete waiting[module.mid];
			if(module.url){
				delete waiting[module.url];
			}
			if(isEmpty(waiting)){
				clearTimer();
				 0  && legacyMode==xd && (legacyMode = sync);
			}
		},

		execComplete = req.idle =
			// says the loader has completed (or not) its work
			function(){
				return !defQ.length && isEmpty(waiting) && !execQ.length && !checkCompleteGuard;
			},

		runMapProg = function(targetMid, map){
			// search for targetMid in map; return the map item if found; falsy otherwise
			if(map){
			for(var i = 0; i < map.length; i++){
				if(map[i][2].test(targetMid)){
					return map[i];
				}
			}
			}
			return 0;
		},

		compactPath = function(path){
			var result = [],
				segment, lastSegment;
			path = path.replace(/\\/g, '/').split('/');
			while(path.length){
				segment = path.shift();
				if(segment==".." && result.length && lastSegment!=".."){
					result.pop();
					lastSegment = result[result.length - 1];
				}else if(segment!="."){
					result.push(lastSegment= segment);
				} // else ignore "."
			}
			return result.join("/");
		},

		makeModuleInfo = function(pid, mid, pack, url){
			if( 0 ){
				var xd= req.isXdUrl(url);
				return {pid:pid, mid:mid, pack:pack, url:url, executed:0, def:0, isXd:xd, isAmd:!!(xd || (packs[pid] && packs[pid].isAmd))};
			}else{
				return {pid:pid, mid:mid, pack:pack, url:url, executed:0, def:0};
			}
		},

		getModuleInfo_ = function(mid, referenceModule, packs, modules, baseUrl, mapProgs, pathsMapProg, alwaysCreate){
			// arguments are passed instead of using lexical variables so that this function my be used independent of the loader (e.g., the builder)
			// alwaysCreate is useful in this case so that getModuleInfo never returns references to real modules owned by the loader
			var pid, pack, midInPackage, mapProg, mapItem, url, result, isRelative, requestedMid;
			requestedMid = mid;
			isRelative = /^\./.test(mid);
			if(/(^\/)|(\:)|(\.js$)/.test(mid) || (isRelative && !referenceModule)){
				// absolute path or protocol of .js filetype, or relative path but no reference module and therefore relative to page
				// whatever it is, it's not a module but just a URL of some sort
				// note: pid===0 indicates the routine is returning an unmodified mid

				return makeModuleInfo(0, mid, 0, mid);
			}else{
				// relative module ids are relative to the referenceModule; get rid of any dots
				mid = compactPath(isRelative ? (referenceModule.mid + "/../" + mid) : mid);
				if(/^\./.test(mid)){
					throw makeError("irrationalPath", mid);
				}
				// at this point, mid is an absolute mid

				// map the mid
				if(referenceModule){
					mapItem = runMapProg(referenceModule.mid, mapProgs);
				}
				mapItem = mapItem || mapProgs.star;
				mapItem = mapItem && runMapProg(mid, mapItem[1]);

				if(mapItem){
					mid = mapItem[1] + mid.substring(mapItem[3]);
					}

				match = mid.match(/^([^\/]+)(\/(.+))?$/);
				pid = match ? match[1] : "";
				if((pack = packs[pid])){
					mid = pid + "/" + (midInPackage = (match[3] || pack.main));
				}else{
					pid = "";
				}

				// search aliases
				var candidateLength = 0,
					candidate = 0;
				forEach(aliases, function(pair){
					var match = mid.match(pair[0]);
					if(match && match.length>candidateLength){
						candidate = isFunction(pair[1]) ? mid.replace(pair[0], pair[1]) : pair[1];
					}
				});
				if(candidate){
					return getModuleInfo_(candidate, 0, packs, modules, baseUrl, mapProgs, pathsMapProg, alwaysCreate);
				}

				result = modules[mid];
				if(result){
					return alwaysCreate ? makeModuleInfo(result.pid, result.mid, result.pack, result.url) : modules[mid];
				}
			}
			// get here iff the sought-after module does not yet exist; therefore, we need to compute the URL given the
			// fully resolved (i.e., all relative indicators and package mapping resolved) module id

			// note: pid!==0 indicates the routine is returning a url that has .js appended unmodified mid
			mapItem = runMapProg(mid, pathsMapProg);
			if(mapItem){
				url = mapItem[1] + mid.substring(mapItem[3]);
			}else if(pid){
				url = pack.location + "/" + midInPackage;
			}else if( 0 ){
				url = "../" + mid;
			}else{
				url = mid;
			}
			// if result is not absolute, add baseUrl
			if(!(/(^\/)|(\:)/.test(url))){
				url = baseUrl + url;
			}
			url += ".js";
			return makeModuleInfo(pid, mid, pack, compactPath(url));
		},

		getModuleInfo = function(mid, referenceModule){
			return getModuleInfo_(mid, referenceModule, packs, modules, req.baseUrl, mapProgs, pathsMapProg);
		},

		resolvePluginResourceId = function(plugin, prid, referenceModule){
			return plugin.normalize ? plugin.normalize(prid, function(mid){return toAbsMid(mid, referenceModule);}) : toAbsMid(prid, referenceModule);
		},

		dynamicPluginUidGenerator = 0,

		getModule = function(mid, referenceModule, immediate){
			// compute and optionally construct (if necessary) the module implied by the mid with respect to referenceModule
			var match, plugin, prid, result;
			match = mid.match(/^(.+?)\!(.*)$/);
			if(match){
				// name was <plugin-module>!<plugin-resource-id>
				plugin = getModule(match[1], referenceModule, immediate);

				if( 0  && legacyMode == sync && !plugin.executed){
					injectModule(plugin);
					if(plugin.injected===arrived && !plugin.executed){
						guardCheckComplete(function(){
							execModule(plugin);
						});
					}
					if(plugin.executed){
						promoteModuleToPlugin(plugin);
					}else{
						// we are in xdomain mode for some reason
						execQ.unshift(plugin);
					}
				}



				if(plugin.executed === executed && !plugin.load){
					// executed the module not knowing it was a plugin
					promoteModuleToPlugin(plugin);
				}

				// if the plugin has not been loaded, then can't resolve the prid and  must assume this plugin is dynamic until we find out otherwise
				if(plugin.load){
					prid = resolvePluginResourceId(plugin, match[2], referenceModule);
					mid = (plugin.mid + "!" + (plugin.dynamic ? ++dynamicPluginUidGenerator + "!" : "") + prid);
				}else{
					prid = match[2];
					mid = plugin.mid + "!" + (++dynamicPluginUidGenerator) + "!waitingForPlugin";
				}
				result = {plugin:plugin, mid:mid, req:createRequire(referenceModule), prid:prid};
			}else{
				result = getModuleInfo(mid, referenceModule);
			}
			return modules[result.mid] || (!immediate && (modules[result.mid] = result));
		},

		toAbsMid = req.toAbsMid = function(mid, referenceModule){
			return getModuleInfo(mid, referenceModule).mid;
		},

		toUrl = req.toUrl = function(name, referenceModule){
			var moduleInfo = getModuleInfo(name+"/x", referenceModule),
				url= moduleInfo.url;
			return fixupUrl(moduleInfo.pid===0 ?
				// if pid===0, then name had a protocol or absolute path; either way, toUrl is the identify function in such cases
				name :
				// "/x.js" since getModuleInfo automatically appends ".js" and we appended "/x" to make name look likde a module id
				url.substring(0, url.length-5)
			);
		},

		nonModuleProps = {
			injected: arrived,
			executed: executed,
			def: nonmodule,
			result: nonmodule
		},

		makeCjs = function(mid){
			return modules[mid] = mix({mid:mid}, nonModuleProps);
		},

		cjsRequireModule = makeCjs("require"),
		cjsExportsModule = makeCjs("exports"),
		cjsModuleModule = makeCjs("module"),

		runFactory = function(module, args){
			req.trace("loader-run-factory", [module.mid]);
			var factory = module.def,
				result;
			 0  && syncExecStack.unshift(module);
			if( 0 ){
				try{
					result= isFunction(factory) ? factory.apply(null, args) : factory;
				}catch(e){
					signal(error, module.result = makeError("factoryThrew", [module, e]));
				}
			}else{
				result= isFunction(factory) ? factory.apply(null, args) : factory;
			}
			module.result = result===undefined && module.cjs ? module.cjs.exports : result;
			 0  && syncExecStack.shift(module);
		},

		abortExec = {},

		defOrder = 0,

		promoteModuleToPlugin = function(pluginModule){
			var plugin = pluginModule.result;
			pluginModule.dynamic = plugin.dynamic;
			pluginModule.normalize = plugin.normalize;
			pluginModule.load = plugin.load;
			return pluginModule;
		},

		resolvePluginLoadQ = function(plugin){
			// plugins is a newly executed module that has a loadQ waiting to run

			// step 1: traverse the loadQ and fixup the mid and prid; remember the map from original mid to new mid
			// recall the original mid was created before the plugin was on board and therefore it was impossible to
			// compute the final mid; accordingly, prid may or may not change, but the mid will definitely change
			var map = {};
			forEach(plugin.loadQ, function(pseudoPluginResource){
				// manufacture and insert the real module in modules
				var prid = resolvePluginResourceId(plugin, pseudoPluginResource.prid, pseudoPluginResource.req.module),
					mid = plugin.dynamic ? pseudoPluginResource.mid.replace(/waitingForPlugin$/, prid) : (plugin.mid + "!" + prid),
					pluginResource = mix(mix({}, pseudoPluginResource), {mid:mid, prid:prid, injected:0});
				if(!modules[mid]){
					// create a new (the real) plugin resource and inject it normally now that the plugin is on board
					injectPlugin(modules[mid] = pluginResource);
				} // else this was a duplicate request for the same (plugin, rid) for a nondynamic plugin

				// pluginResource is really just a placeholder with the wrong mid (because we couldn't calculate it until the plugin was on board)
				// mark is as arrived and delete it from modules; the real module was requested above
				map[pseudoPluginResource.mid] = modules[mid];
				setArrived(pseudoPluginResource);
				delete modules[pseudoPluginResource.mid];
			});
			plugin.loadQ = 0;

			// step2: replace all references to any placeholder modules with real modules
			var substituteModules = function(module){
				for(var replacement, deps = module.deps || [], i = 0; i<deps.length; i++){
					replacement = map[deps[i].mid];
					if(replacement){
						deps[i] = replacement;
					}
				}
			};
			for(var p in modules){
				substituteModules(modules[p]);
			}
			forEach(execQ, substituteModules);
		},

		finishExec = function(module){
			req.trace("loader-finish-exec", [module.mid]);
			module.executed = executed;
			module.defOrder = defOrder++;
			 0  && forEach(module.provides, function(cb){ cb(); });
			if(module.loadQ){
				// the module was a plugin
				promoteModuleToPlugin(module);
				resolvePluginLoadQ(module);
			}
			// remove all occurences of this module from the execQ
			for(i = 0; i < execQ.length;){
				if(execQ[i] === module){
					execQ.splice(i, 1);
				}else{
					i++;
				}
			}
			// delete references to synthetic modules
			if (/^require\*/.test(module.mid)) {
				delete modules[module.mid];
			}
		},

		circleTrace = [],

		execModule = function(module, strict){
			// run the dependency vector, then run the factory for module
			if(module.executed === executing){
				req.trace("loader-circular-dependency", [circleTrace.concat(module.mid).join("->")]);
				return (!module.def || strict) ? abortExec :  (module.cjs && module.cjs.exports);
			}
			// at this point the module is either not executed or fully executed


			if(!module.executed){
				if(!module.def){
					return abortExec;
				}
				var mid = module.mid,
					deps = module.deps || [],
					arg, argResult,
					args = [],
					i = 0;

				if( 0 ){
					circleTrace.push(mid);
					req.trace("loader-exec-module", ["exec", circleTrace.length, mid]);
				}

				// for circular dependencies, assume the first module encountered was executed OK
				// modules that circularly depend on a module that has not run its factory will get
				// the premade cjs.exports===module.result. They can take a reference to this object and/or
				// add properties to it. When the module finally runs its factory, the factory can
				// read/write/replace this object. Notice that so long as the object isn't replaced, any
				// reference taken earlier while walking the deps list is still valid.
				module.executed = executing;
				while(i < deps.length){
					arg = deps[i++];
					argResult = ((arg === cjsRequireModule) ? createRequire(module) :
									((arg === cjsExportsModule) ? module.cjs.exports :
										((arg === cjsModuleModule) ? module.cjs :
											execModule(arg, strict))));
					if(argResult === abortExec){
						module.executed = 0;
						req.trace("loader-exec-module", ["abort", mid]);
						 0  && circleTrace.pop();
						return abortExec;
					}
					args.push(argResult);
				}
				runFactory(module, args);
				finishExec(module);
				 0  && circleTrace.pop();
			}
			// at this point the module is guaranteed fully executed

			return module.result;
		},


		checkCompleteGuard = 0,

		guardCheckComplete = function(proc){
			try{
				checkCompleteGuard++;
				proc();
			}finally{
				checkCompleteGuard--;
			}
			if(execComplete()){
				signal("idle", []);
			}
		},

		checkComplete = function(){
			// keep going through the execQ as long as at least one factory is executed
			// plugins, recursion, cached modules all make for many execution path possibilities
			if(checkCompleteGuard){
				return;
			}
			guardCheckComplete(function(){
				checkDojoRequirePlugin();
				for(var currentDefOrder, module, i = 0; i < execQ.length;){
					currentDefOrder = defOrder;
					module = execQ[i];
					execModule(module);
					if(currentDefOrder!=defOrder){
						// defOrder was bumped one or more times indicating something was executed (note, this indicates
						// the execQ was modified, maybe a lot (for example a later module causes an earlier module to execute)
						checkDojoRequirePlugin();
						i = 0;
					}else{
						// nothing happened; check the next module in the exec queue
						i++;
					}
				}
			});
		};


	if( 0 ){
		req.undef = function(moduleId, referenceModule){
			// In order to reload a module, it must be undefined (this routine) and then re-requested.
			// This is useful for testing frameworks (at least).
			var module = getModule(moduleId, referenceModule);
			setArrived(module);
			delete modules[module.mid];
		};
	}

	if( 1 ){
		if( 1 ===undefined){
			 1 || has.add("dojo-loader-eval-hint-url", 1);
		}

		var fixupUrl= function(url){
				url += ""; // make sure url is a Javascript string (some paths may be a Java string)
				return url + (cacheBust ? ((/\?/.test(url) ? "&" : "?") + cacheBust) : "");
			},

			injectPlugin = function(
				module
			){
				// injects the plugin module given by module; may have to inject the plugin itself
				var plugin = module.plugin;

				if(plugin.executed === executed && !plugin.load){
					// executed the module not knowing it was a plugin
					promoteModuleToPlugin(plugin);
				}

				var onLoad = function(def){
						module.result = def;
						setArrived(module);
						finishExec(module);
						checkComplete();
					};

				if(plugin.load){
					plugin.load(module.prid, module.req, onLoad);
				}else if(plugin.loadQ){
					plugin.loadQ.push(module);
				}else{
					// the unshift instead of push is important: we don't want plugins to execute as
					// dependencies of some other module because this may cause circles when the plugin
					// loadQ is run; also, generally, we want plugins to run early since they may load
					// several other modules and therefore can potentially unblock many modules
					plugin.loadQ = [module];
					execQ.unshift(plugin);
					injectModule(plugin);
				}
			},

			// for IE, injecting a module may result in a recursive execution if the module is in the cache

			cached = 0,

			injectingModule = 0,

			injectingCachedModule = 0,

			evalModuleText = function(text, module){
				// see def() for the injectingCachedModule bracket; it simply causes a short, safe curcuit
				if(has("config-stripStrict")){
					text = text.replace(/"use strict"/g, '');
				}
				injectingCachedModule = 1;
				if( 0 ){
					try{
						if(text===cached){
							cached.call(null);
						}else{
							req.eval(text,  1  ? module.url : module.mid);
						}
					}catch(e){
						signal(error, makeError("evalModuleThrew", module));
					}
				}else{
					if(text===cached){
						cached.call(null);
					}else{
						req.eval(text,  1  ? module.url : module.mid);
					}
				}
				injectingCachedModule = 0;
			},

			injectModule = function(module){
				// Inject the module. In the browser environment, this means appending a script element into
				// the document; in other environments, it means loading a file.
				//
				// If in synchronous mode, then get the module synchronously if it's not xdomainLoading.

				var mid = module.mid,
					url = module.url;
				if(module.executed || module.injected || waiting[mid] || (module.url && ((module.pack && waiting[module.url]===module.pack) || waiting[module.url]==1))){
					return;
				}
				setRequested(module);

				if( 0 ){
					var viaCombo = 0;
					if(module.plugin && module.plugin.isCombo){
						// a combo plugin; therefore, must be handled by combo service
						// the prid should have already been converted to a URL (if required by the plugin) during
						// the normalze process; in any event, there is no way for the loader to know how to
						// to the conversion; therefore the third argument is zero
						req.combo.add(module.plugin.mid, module.prid, 0, req);
						viaCombo = 1;
					}else if(!module.plugin){
						viaCombo = req.combo.add(0, module.mid, module.url, req);
					}
					if(viaCombo){
						comboPending= 1;
						return;
					}
				}

				if(module.plugin){
					injectPlugin(module);
					return;
				} // else a normal module (not a plugin)


				var onLoadCallback = function(){
					runDefQ(module);
					if(module.injected !== arrived){
						// the script that contained the module arrived and has been executed yet
						// nothing was added to the defQ (so it wasn't an AMD module) and the module
						// wasn't marked as arrived by dojo.provide (so it wasn't a v1.6- module);
						// therefore, it must not have been a module; adjust state accordingly
						setArrived(module);
						mix(module, nonModuleProps);
						req.trace("loader-define-nonmodule", [module.url]);
					}

					if( 0  && legacyMode){
						// must call checkComplete even in for sync loader because we may be in xdomainLoading mode;
						// but, if xd loading, then don't call checkComplete until out of the current sync traversal
						// in order to preserve order of execution of the dojo.required modules
						!syncExecStack.length && checkComplete();
					}else{
						checkComplete();
					}
				};
				cached = cache[mid] || cache[urlKeyPrefix + module.url];
				if(cached){
					req.trace("loader-inject", ["cache", module.mid, url]);
					evalModuleText(cached, module);
					onLoadCallback();
					return;
				}
				if( 0  && legacyMode){
					if(module.isXd){
						// switch to async mode temporarily; if current legacyMode!=sync, then is must be one of {legacyAsync, xd, false}
						legacyMode==sync && (legacyMode = xd);
						// fall through and load via script injection
					}else if(module.isAmd && legacyMode!=sync){
						// fall through and load via script injection
					}else{
						// mode may be sync, xd/legacyAsync, or async; module may be AMD or legacy; but module is always located on the same domain
						var xhrCallback = function(text){
							if(legacyMode==sync){
								// the top of syncExecStack gives the current synchronously executing module; the loader needs
								// to know this if it has to switch to async loading in the middle of evaluating a legacy module
								// this happens when a modules dojo.require's a module that must be loaded async because it's xdomain
								// (using unshift/shift because there is no back() methods for Javascript arrays)
								syncExecStack.unshift(module);
								evalModuleText(text, module);
								syncExecStack.shift();

								// maybe the module was an AMD module
								runDefQ(module);

								// legacy modules never get to defineModule() => cjs and injected never set; also evaluation implies executing
								if(!module.cjs){
									setArrived(module);
									finishExec(module);
								}

								if(module.finish){
									// while synchronously evaluating this module, dojo.require was applied referencing a module
									// that had to be loaded async; therefore, the loader stopped answering all dojo.require
									// requests so they could be answered completely in the correct sequence; module.finish gives
									// the list of dojo.requires that must be re-applied once all target modules are available;
									// make a synthetic module to execute the dojo.require's in the correct order

									// compute a guarnateed-unique mid for the synthetic finish module; remember the finish vector; remove it from the reference module
									// TODO: can we just leave the module.finish...what's it hurting?
									var finishMid = mid + "*finish",
										finish = module.finish;
									delete module.finish;

									def(finishMid, ["dojo", ("dojo/require!" + finish.join(",")).replace(/\./g, "/")], function(dojo){
										forEach(finish, function(mid){ dojo.require(mid); });
									});
									// unshift, not push, which causes the current traversal to be reattempted from the top
									execQ.unshift(getModule(finishMid));
								}
								onLoadCallback();
							}else{
								text = transformToAmd(module, text);
								if(text){
									evalModuleText(text, module);
									onLoadCallback();
								}else{
									// if transformToAmd returned falsy, then the module was already AMD and it can be script-injected
									// do so to improve debugability(even though it means another download...which probably won't happen with a good browser cache)
									injectingModule = module;
									req.injectUrl(fixupUrl(url), onLoadCallback, module);
									injectingModule = 0;
								}
							}
						};

						req.trace("loader-inject", ["xhr", module.mid, url, legacyMode!=sync]);
						if( 0 ){
							try{
								req.getText(url, legacyMode!=sync, xhrCallback);
							}catch(e){
								signal(error, makeError("xhrInjectFailed", [module, e]));
							}
						}else{
							req.getText(url, legacyMode!=sync, xhrCallback);
						}
						return;
					}
				} // else async mode or fell through in xdomain loading mode; either way, load by script injection
				req.trace("loader-inject", ["script", module.mid, url]);
				injectingModule = module;
				req.injectUrl(fixupUrl(url), onLoadCallback, module);
				injectingModule = 0;
			},

			defineModule = function(module, deps, def){
				req.trace("loader-define-module", [module.mid, deps]);

				if( 0  && module.plugin && module.plugin.isCombo){
					// the module is a plugin resource loaded by the combo service
					// note: check for module.plugin should be enough since normal plugin resources should
					// not follow this path; module.plugin.isCombo is future-proofing belt and suspenders
					module.result = isFunction(def) ? def() : def;
					setArrived(module);
					finishExec(module);
					return module;
				};

				var mid = module.mid;
				if(module.injected === arrived){
					signal(error, makeError("multipleDefine", module));
					return module;
				}
				mix(module, {
					deps: deps,
					def: def,
					cjs: {
						id: module.mid,
						uri: module.url,
						exports: (module.result = {}),
						setExports: function(exports){
							module.cjs.exports = exports;
						},
						config:function(){
							return module.config;
						}
					}
				});

				// resolve deps with respect to this module
				for(var i = 0; i < deps.length; i++){
					deps[i] = getModule(deps[i], module);
				}

				if( 0  && legacyMode && !waiting[mid]){
					// the module showed up without being asked for; it was probably in a <script> element
					injectDependencies(module);
					execQ.push(module);
					checkComplete();
				}
				setArrived(module);

				if(!isFunction(def) && !deps.length){
					module.result = def;
					finishExec(module);
				}

				return module;
			},

			runDefQ = function(referenceModule, mids){
				// defQ is an array of [id, dependencies, factory]
				// mids (if any) is a vector of mids given by a combo service
				var definedModules = [],
					module, args;
				while(defQ.length){
					args = defQ.shift();
					mids && (args[0]= mids.shift());
					// explicit define indicates possible multiple modules in a single file; delay injecting dependencies until defQ fully
					// processed since modules earlier in the queue depend on already-arrived modules that are later in the queue
					// TODO: what if no args[0] and no referenceModule
					module = (args[0] && getModule(args[0])) || referenceModule;
					definedModules.push([module, args[1], args[2]]);
				}
				consumePendingCacheInsert(referenceModule);
				forEach(definedModules, function(args){
					injectDependencies(defineModule.apply(null, args));
				});
			};
	}

	var timerId = 0,
		clearTimer = noop,
		startTimer = noop;
	if( 0 ){
		// Timer machinery that monitors how long the loader is waiting and signals an error when the timer runs out.
		clearTimer = function(){
			timerId && clearTimeout(timerId);
			timerId = 0;
		},

		startTimer = function(){
			clearTimer();
			if(req.waitms){
				timerId = window.setTimeout(function(){
					clearTimer();
					signal(error, makeError("timeout", waiting));
				}, req.waitms);
			}
		};
	}

	if( 1 ){
		// the typically unnecessary !! in front of doc.attachEvent is due to an opera bug; see	#15096
		has.add("ie-event-behavior", !!doc.attachEvent && (typeof opera === "undefined" || opera.toString() != "[object Opera]"));
	}

	if( 1  && ( 1  ||  1 )){
		var domOn = function(node, eventName, ieEventName, handler){
				// Add an event listener to a DOM node using the API appropriate for the current browser;
				// return a function that will disconnect the listener.
				if(!has("ie-event-behavior")){
					node.addEventListener(eventName, handler, false);
					return function(){
						node.removeEventListener(eventName, handler, false);
					};
				}else{
					node.attachEvent(ieEventName, handler);
					return function(){
						node.detachEvent(ieEventName, handler);
					};
				}
			},
			windowOnLoadListener = domOn(window, "load", "onload", function(){
				req.pageLoaded = 1;
				doc.readyState!="complete" && (doc.readyState = "complete");
				windowOnLoadListener();
			});

		if( 1 ){
			// if the loader is on the page, there must be at least one script element
			// getting its parent and then doing insertBefore solves the "Operation Aborted"
			// error in IE from appending to a node that isn't properly closed; see
			// dojo/tests/_base/loader/requirejs/simple-badbase.html for an example
			var sibling = doc.getElementsByTagName("script")[0],
				insertPoint= sibling.parentNode;
			req.injectUrl = function(url, callback, owner){
				// insert a script element to the insert-point element with src=url;
				// apply callback upon detecting the script has loaded.

				var node = owner.node = doc.createElement("script"),
					onLoad = function(e){
						e = e || window.event;
						var node = e.target || e.srcElement;
						if(e.type === "load" || /complete|loaded/.test(node.readyState)){
							loadDisconnector();
							errorDisconnector();
							callback && callback();
						}
					},
					loadDisconnector = domOn(node, "load", "onreadystatechange", onLoad),
					errorDisconnector = domOn(node, "error", "onerror", function(e){
						loadDisconnector();
						errorDisconnector();
						signal(error, makeError("scriptError", [url, e]));
					});

				node.type = "text/javascript";
				node.charset = "utf-8";
				node.src = url;
				insertPoint.insertBefore(node, sibling);
				return node;
			};
		}
	}

	if( 0 ){
		req.log = function(){
			try{
				for(var i = 0; i < arguments.length; i++){
					0 && console.log(arguments[i]);
				}
			}catch(e){}
		};
	}else{
		req.log = noop;
	}

	if( 0 ){
		var trace = req.trace = function(
			group,	// the trace group to which this application belongs
			args	// the contents of the trace
		){
			///
			// Tracing interface by group.
			//
			// Sends the contents of args to the console iff (req.trace.on && req.trace[group])

			if(trace.on && trace.group[group]){
				signal("trace", [group, args]);
				for(var arg, dump = [], text= "trace:" + group + (args.length ? (":" + args[0]) : ""), i= 1; i<args.length;){
					arg = args[i++];
					if(isString(arg)){
						text += ", " + arg;
					}else{
						dump.push(arg);
					}
				}
				req.log(text);
				dump.length && dump.push(".");
				req.log.apply(req, dump);
			}
		};
		mix(trace, {
			on:1,
			group:{},
			set:function(group, value){
				if(isString(group)){
					trace.group[group]= value;
				}else{
					mix(trace.group, group);
				}
			}
		});
		trace.set(mix(mix(mix({}, defaultConfig.trace), userConfig.trace), dojoSniffConfig.trace));
		on("config", function(config){
			config.trace && trace.set(config.trace);
		});
	}else{
		req.trace = noop;
	}

	var def = function(
		mid,		  //(commonjs.moduleId, optional) list of modules to be loaded before running factory
		dependencies, //(array of commonjs.moduleId, optional)
		factory		  //(any)
	){
		///
		// Advises the loader of a module factory. //Implements http://wiki.commonjs.org/wiki/Modules/AsynchronousDefinition.
		///
		//note
		// CommonJS factory scan courtesy of http://requirejs.org

		var arity = arguments.length,
			defaultDeps = ["require", "exports", "module"],
			// the predominate signature...
			args = [0, mid, dependencies];
		if(arity==1){
			args = [0, (isFunction(mid) ? defaultDeps : []), mid];
		}else if(arity==2 && isString(mid)){
			args = [mid, (isFunction(dependencies) ? defaultDeps : []), dependencies];
		}else if(arity==3){
			args = [mid, dependencies, factory];
		}

		if( 0  && args[1]===defaultDeps){
			args[2].toString()
				.replace(/(\/\*([\s\S]*?)\*\/|\/\/(.*)$)/mg, "")
				.replace(/require\(["']([\w\!\-_\.\/]+)["']\)/g, function(match, dep){
				args[1].push(dep);
			});
		}

		req.trace("loader-define", args.slice(0, 2));
		var targetModule = args[0] && getModule(args[0]),
			module;
		if(targetModule && !waiting[targetModule.mid]){
			// given a mid that hasn't been requested; therefore, defined through means other than injecting
			// consequent to a require() or define() application; examples include defining modules on-the-fly
			// due to some code path or including a module in a script element. In any case,
			// there is no callback waiting to finish processing and nothing to trigger the defQ and the
			// dependencies are never requested; therefore, do it here.
			injectDependencies(defineModule(targetModule, args[1], args[2]));
		}else if(!has("ie-event-behavior") || ! 1  || injectingCachedModule){
			// not IE path: anonymous module and therefore must have been injected; therefore, onLoad will fire immediately
			// after script finishes being evaluated and the defQ can be run from that callback to detect the module id
			defQ.push(args);
		}else{
			// IE path: possibly anonymous module and therefore injected; therefore, cannot depend on 1-to-1,
			// in-order exec of onLoad with script eval (since it's IE) and must manually detect here
			targetModule = targetModule || injectingModule;
			if(!targetModule){
				for(mid in waiting){
					module = modules[mid];
					if(module && module.node && module.node.readyState === 'interactive'){
						targetModule = module;
						break;
					}
				}
				if( 0  && !targetModule){
					for(var i = 0; i<combosPending.length; i++){
						targetModule = combosPending[i];
						if(targetModule.node && targetModule.node.readyState === 'interactive'){
							break;
						}
						targetModule= 0;
					}
				}
			}
			if( 0  && isArray(targetModule)){
				injectDependencies(defineModule(getModule(targetModule.shift()), args[1], args[2]));
				if(!targetModule.length){
					combosPending.splice(i, 1);
				}
			}else if(targetModule){
				consumePendingCacheInsert(targetModule);
				injectDependencies(defineModule(targetModule, args[1], args[2]));
			}else{
				signal(error, makeError("ieDefineFailed", args[0]));
			}
			checkComplete();
		}
	};
	def.amd = {
		vendor:"dojotoolkit.org"
	};

	if( 0 ){
		req.def = def;
	}

	// allow config to override default implemention of named functions; this is useful for
	// non-browser environments, e.g., overriding injectUrl, getText, log, etc. in node.js, Rhino, etc.
	// also useful for testing and monkey patching loader
	mix(mix(req, defaultConfig.loaderPatch), userConfig.loaderPatch);

	// now that req is fully initialized and won't change, we can hook it up to the error signal
	on(error, function(arg){
		try{
			console.error(arg);
			if(arg instanceof Error){
				for(var p in arg){
					0 && console.log(p + ":", arg[p]);
				}
				0 && console.log(".");
			}
		}catch(e){}
	});

	// always publish these
	mix(req, {
		uid:uid,
		cache:cache,
		packs:packs
	});


	if( 0 ){
		mix(req, {
			// these may be interesting to look at when debugging
			paths:paths,
			aliases:aliases,
			modules:modules,
			legacyMode:legacyMode,
			execQ:execQ,
			defQ:defQ,
			waiting:waiting,

			// these are used for testing
			// TODO: move testing infrastructure to a different has feature
			packs:packs,
			mapProgs:mapProgs,
			pathsMapProg:pathsMapProg,
			listenerQueues:listenerQueues,

			// these are used by the builder (at least)
			computeMapProg:computeMapProg,
			runMapProg:runMapProg,
			compactPath:compactPath,
			getModuleInfo:getModuleInfo_
		});
	}

	// the loader can be defined exactly once; look for global define which is the symbol AMD loaders are
	// *required* to define (as opposed to require, which is optional)
	if(global.define){
		if( 0 ){
			signal(error, makeError("defineAlreadyDefined", 0));
		}
		return;
	}else{
		global.define = def;
		global.require = req;
		if( 0 ){
			require= req;
		}
	}

	if( 0  && req.combo && req.combo.plugins){
		var plugins = req.combo.plugins,
			pluginName;
		for(pluginName in plugins){
			mix(mix(getModule(pluginName), plugins[pluginName]), {isCombo:1, executed:"executed", load:1});
		}
	}

	if( 1 ){
		forEach(delayedModuleConfig, function(c){ config(c); });
		var bootDeps = dojoSniffConfig.deps ||	userConfig.deps || defaultConfig.deps,
			bootCallback = dojoSniffConfig.callback || userConfig.callback || defaultConfig.callback;
		req.boot = (bootDeps || bootCallback) ? [bootDeps || [], bootCallback] : 0;
	}
	if(! 1 ){
		!req.async && req(["dojo"]);
		req.boot && req.apply(null, req.boot);
	}
})
(this.dojoConfig || this.djConfig || this.require || {}, {
		async:1,
		hasCache:{
				'config-selectorEngine':"lite",
				'config-tlmSiblingOfDojo':1,
				'dojo-built':1,
				'dojo-loader':1,
				dom:1,
				'host-browser':1
		},
		packages:[
				{
					 location:".",
					 name:"dojo"
				},
				{
					 location:"../dijit",
					 name:"dijit"
				},
				{
					 location:"../dojox",
					 name:"dojox"
				},
				{
					 location:"../parking-client",
					 name:"parking-client"
				}
		]
});require({cache:{
'parking-client/main':function(){
define([
	'dojo/ready',
	'dojox/mobile/parser',
	'dojox/mobile/Heading',
	'dojox/mobile/ListItem',
	'dojox/mobile/ScrollableView',
	'dojox/mobile/RoundRectCategory',
	'dojox/mobile/RoundRectList',
	'dojox/mobile/TabBar',
	'dojox/mobile/TabBarButton',
	'dojox/mobile/View'
], function (ready, parser) {
	ready(function () {
		parser.parse();
	});
});
},
'dojo/ready':function(){
define(["./_base/kernel", "./has", "require", "./domReady", "./_base/lang"], function(dojo, has, require, domReady, lang){
	// module:
	//		dojo/ready
	// note:
	//		This module should be unnecessary in dojo 2.0

	var
		// truthy if DOMContentLoaded or better (e.g., window.onload fired) has been achieved
		isDomReady = 0,

		// a function to call to cause onLoad to be called when all requested modules have been loaded
		requestCompleteSignal,

		// The queue of functions waiting to execute as soon as dojo.ready conditions satisfied
		loadQ = [],

		// prevent recursion in onLoad
		onLoadRecursiveGuard = 0,

		handleDomReady = function(){
			isDomReady = 1;
			dojo._postLoad = dojo.config.afterOnLoad = true;
			if(loadQ.length){
				requestCompleteSignal(onLoad);
			}
		},

		// run the next function queued with dojo.ready
		onLoad = function(){
			if(isDomReady && !onLoadRecursiveGuard && loadQ.length){
				//guard against recursions into this function
				onLoadRecursiveGuard = 1;
				var f = loadQ.shift();
					try{
						f();
					}
						// FIXME: signal the error via require.on
					finally{
						onLoadRecursiveGuard = 0;
					}
				onLoadRecursiveGuard = 0;
				if(loadQ.length){
					requestCompleteSignal(onLoad);
				}
			}
		};

	require.on("idle", onLoad);
	requestCompleteSignal = function(){
		if(require.idle()){
			onLoad();
		} // else do nothing, onLoad will be called with the next idle signal
	};

	var ready = dojo.ready = dojo.addOnLoad = function(priority, context, callback){
		// summary:
		//		Add a function to execute on DOM content loaded and all requested modules have arrived and been evaluated.
		//		In most cases, the `domReady` plug-in should suffice and this method should not be needed.
		// priority: Integer?
		//		The order in which to exec this callback relative to other callbacks, defaults to 1000
		// context: Object?|Function
		//		The context in which to run execute callback, or a callback if not using context
		// callback: Function?
		//		The function to execute.
		//
		// example:
		//	Simple DOM and Modules ready syntax
		//	|	require(["dojo/ready"], function(ready){
		//	|		ready(function(){ alert("Dom ready!"); });
		//	|	});
		//
		// example:
		//	Using a priority
		//	|	require(["dojo/ready"], function(ready){
		//	|		ready(2, function(){ alert("low priority ready!"); })
		//	|	});
		//
		// example:
		//	Using context
		//	|	require(["dojo/ready"], function(ready){
		//	|		ready(foo, function(){
		//	|			// in here, this == foo
		//	|		});
		//	|	});
		//
		// example:
		//	Using dojo/hitch style args:
		//	|	require(["dojo/ready"], function(ready){
		//	|		var foo = { dojoReady: function(){ console.warn(this, "dojo dom and modules ready."); } };
		//	|		ready(foo, "dojoReady");
		//	|	});

		var hitchArgs = lang._toArray(arguments);
		if(typeof priority != "number"){
			callback = context;
			context = priority;
			priority = 1000;
		}else{
			hitchArgs.shift();
		}
		callback = callback ?
			lang.hitch.apply(dojo, hitchArgs) :
			function(){
				context();
			};
		callback.priority = priority;
		for(var i = 0; i < loadQ.length && priority >= loadQ[i].priority; i++){}
		loadQ.splice(i, 0, callback);
		requestCompleteSignal();
	};

	 1 || has.add("dojo-config-addOnLoad", 1);
	if( 1 ){
		var dca = dojo.config.addOnLoad;
		if(dca){
			ready[(lang.isArray(dca) ? "apply" : "call")](dojo, dca);
		}
	}

	if( 0  && dojo.config.parseOnLoad && !dojo.isAsync){
		ready(99, function(){
			if(!dojo.parser){
				dojo.deprecated("Add explicit require(['dojo/parser']);", "", "2.0");
				require(["dojo/parser"]);
			}
		});
	}

	if( 1 ){
		domReady(handleDomReady);
	}else{
		handleDomReady();
	}

	return ready;
});

},
'dojo/_base/kernel':function(){
define(["../has", "./config", "require", "module"], function(has, config, require, module){
	// module:
	//		dojo/_base/kernel

	// This module is the foundational module of the dojo boot sequence; it defines the dojo object.

	var
		// loop variables for this module
		i, p,

		// create dojo, dijit, and dojox
		// FIXME: in 2.0 remove dijit, dojox being created by dojo
		dijit = {},
		dojox = {},
		dojo = {
			// summary:
			//		This module is the foundational module of the dojo boot sequence; it defines the dojo object.

			// notice dojo takes ownership of the value of the config module
			config:config,
			global:this,
			dijit:dijit,
			dojox:dojox
		};


	// Configure the scope map. For a 100% AMD application, the scope map is not needed other than to provide
	// a _scopeName property for the dojo, dijit, and dojox root object so those packages can create
	// unique names in the global space.
	//
	// Built, legacy modules use the scope map to allow those modules to be expressed as if dojo, dijit, and dojox,
	// where global when in fact they are either global under different names or not global at all. In v1.6-, the
	// config variable "scopeMap" was used to map names as used within a module to global names. This has been
	// subsumed by the AMD map configuration variable which can relocate packages to different names. For backcompat,
	// only the "*" mapping is supported. See http://livedocs.dojotoolkit.org/developer/design/loader#legacy-cross-domain-mode for details.
	//
	// The following computations contort the packageMap for this dojo instance into a scopeMap.
	var scopeMap =
			// a map from a name used in a legacy module to the (global variable name, object addressed by that name)
			// always map dojo, dijit, and dojox
			{
				dojo:["dojo", dojo],
				dijit:["dijit", dijit],
				dojox:["dojox", dojox]
			},

		packageMap =
			// the package map for this dojo instance; note, a foreign loader or no pacakgeMap results in the above default config
			(require.map && require.map[module.id.match(/[^\/]+/)[0]]),

		item;


	// process all mapped top-level names for this instance of dojo
	for(p in packageMap){
		if(scopeMap[p]){
			// mapped dojo, dijit, or dojox
			scopeMap[p][0] = packageMap[p];
		}else{
			// some other top-level name
			scopeMap[p] = [packageMap[p], {}];
		}
	}

	// publish those names to _scopeName and, optionally, the global namespace
	for(p in scopeMap){
		item = scopeMap[p];
		item[1]._scopeName = item[0];
		if(!config.noGlobals){
			this[item[0]] = item[1];
		}
	}
	dojo.scopeMap = scopeMap;

	/*===== dojo.__docParserConfigureScopeMap(scopeMap); =====*/

	// FIXME: dojo.baseUrl and dojo.config.baseUrl should be deprecated
	dojo.baseUrl = dojo.config.baseUrl = require.baseUrl;
	dojo.isAsync = ! 1  || require.async;
	dojo.locale = config.locale;

	var rev = "$Rev: 30226 $".match(/\d+/);
	dojo.version = {
		// summary:
		//		Version number of the Dojo Toolkit
		// description:
		//		Hash about the version, including
		//
		//		- major: Integer: Major version. If total version is "1.2.0beta1", will be 1
		//		- minor: Integer: Minor version. If total version is "1.2.0beta1", will be 2
		//		- patch: Integer: Patch version. If total version is "1.2.0beta1", will be 0
		//		- flag: String: Descriptor flag. If total version is "1.2.0beta1", will be "beta1"
		//		- revision: Number: The SVN rev from which dojo was pulled

		major: 1, minor: 8, patch: 3, flag: "",
		revision: rev ? +rev[0] : NaN,
		toString: function(){
			var v = dojo.version;
			return v.major + "." + v.minor + "." + v.patch + v.flag + " (" + v.revision + ")";	// String
		}
	};

	// If  1  is truthy, then as a dojo module is defined it should push it's definitions
	// into the dojo object, and conversely. In 2.0, it will likely be unusual to augment another object
	// as a result of defining a module. This has feature gives a way to force 2.0 behavior as the code
	// is migrated. Absent specific advice otherwise, set extend-dojo to truthy.
	 1 || has.add("extend-dojo", 1);


	(Function("d", "d.eval = function(){return d.global.eval ? d.global.eval(arguments[0]) : eval(arguments[0]);}"))(dojo);
	/*=====
	dojo.eval = function(scriptText){
		// summary:
		//		A legacy method created for use exclusively by internal Dojo methods. Do not use this method
		//		directly unless you understand its possibly-different implications on the platforms your are targeting.
		// description:
		//		Makes an attempt to evaluate scriptText in the global scope. The function works correctly for browsers
		//		that support indirect eval.
		//
		//		As usual, IE does not. On IE, the only way to implement global eval is to
		//		use execScript. Unfortunately, execScript does not return a value and breaks some current usages of dojo.eval.
		//		This implementation uses the technique of executing eval in the scope of a function that is a single scope
		//		frame below the global scope; thereby coming close to the global scope. Note carefully that
		//
		//		dojo.eval("var pi = 3.14;");
		//
		//		will define global pi in non-IE environments, but define pi only in a temporary local scope for IE. If you want
		//		to define a global variable using dojo.eval, write something like
		//
		//		dojo.eval("window.pi = 3.14;")
		// scriptText:
		//		The text to evaluation.
		// returns:
		//		The result of the evaluation. Often `undefined`
	};
	=====*/


	if( 0 ){
		dojo.exit = function(exitcode){
			quit(exitcode);
		};
	}else{
		dojo.exit = function(){
		};
	}

	 1 || has.add("dojo-guarantee-console",
		// ensure that console.log, console.warn, etc. are defined
		1
	);
	if( 1 ){
		typeof console != "undefined" || (console = {});
		//	Be careful to leave 'log' always at the end
		var cn = [
			"assert", "count", "debug", "dir", "dirxml", "error", "group",
			"groupEnd", "info", "profile", "profileEnd", "time", "timeEnd",
			"trace", "warn", "log"
		];
		var tn;
		i = 0;
		while((tn = cn[i++])){
			if(!console[tn]){
				(function(){
					var tcn = tn + "";
					console[tcn] = ('log' in console) ? function(){
						var a = Array.apply({}, arguments);
						a.unshift(tcn + ":");
						console["log"](a.join(" "));
					} : function(){};
					console[tcn]._fake = true;
				})();
			}
		}
	}

	 0 && has.add("dojo-debug-messages",
		// include dojo.deprecated/dojo.experimental implementations
		!!config.isDebug
	);
	dojo.deprecated = dojo.experimental =  function(){};
	if( 0 ){
		dojo.deprecated = function(/*String*/ behaviour, /*String?*/ extra, /*String?*/ removal){
			// summary:
			//		Log a debug message to indicate that a behavior has been
			//		deprecated.
			// behaviour: String
			//		The API or behavior being deprecated. Usually in the form
			//		of "myApp.someFunction()".
			// extra: String?
			//		Text to append to the message. Often provides advice on a
			//		new function or facility to achieve the same goal during
			//		the deprecation period.
			// removal: String?
			//		Text to indicate when in the future the behavior will be
			//		removed. Usually a version number.
			// example:
			//	| dojo.deprecated("myApp.getTemp()", "use myApp.getLocaleTemp() instead", "1.0");

			var message = "DEPRECATED: " + behaviour;
			if(extra){ message += " " + extra; }
			if(removal){ message += " -- will be removed in version: " + removal; }
			console.warn(message);
		};

		dojo.experimental = function(/* String */ moduleName, /* String? */ extra){
			// summary:
			//		Marks code as experimental.
			// description:
			//		This can be used to mark a function, file, or module as
			//		experimental.	 Experimental code is not ready to be used, and the
			//		APIs are subject to change without notice.	Experimental code may be
			//		completed deleted without going through the normal deprecation
			//		process.
			// moduleName: String
			//		The name of a module, or the name of a module file or a specific
			//		function
			// extra: String?
			//		some additional message for the user
			// example:
			//	| dojo.experimental("dojo.data.Result");
			// example:
			//	| dojo.experimental("dojo.weather.toKelvin()", "PENDING approval from NOAA");

			var message = "EXPERIMENTAL: " + moduleName + " -- APIs subject to change without notice.";
			if(extra){ message += " " + extra; }
			console.warn(message);
		};
	}

	 1 || has.add("dojo-modulePaths",
		// consume dojo.modulePaths processing
		1
	);
	if( 1 ){
		// notice that modulePaths won't be applied to any require's before the dojo/_base/kernel factory is run;
		// this is the v1.6- behavior.
		if(config.modulePaths){
			dojo.deprecated("dojo.modulePaths", "use paths configuration");
			var paths = {};
			for(p in config.modulePaths){
				paths[p.replace(/\./g, "/")] = config.modulePaths[p];
			}
			require({paths:paths});
		}
	}

	 1 || has.add("dojo-moduleUrl",
		// include dojo.moduleUrl
		1
	);
	if( 1 ){
		dojo.moduleUrl = function(/*String*/module, /*String?*/url){
			// summary:
			//		Returns a URL relative to a module.
			// example:
			//	|	var pngPath = dojo.moduleUrl("acme","images/small.png");
			//	|	0 && console.dir(pngPath); // list the object properties
			//	|	// create an image and set it's source to pngPath's value:
			//	|	var img = document.createElement("img");
			//	|	img.src = pngPath;
			//	|	// add our image to the document
			//	|	dojo.body().appendChild(img);
			// example:
			//		you may de-reference as far as you like down the package
			//		hierarchy.  This is sometimes handy to avoid lenghty relative
			//		urls or for building portable sub-packages. In this example,
			//		the `acme.widget` and `acme.util` directories may be located
			//		under different roots (see `dojo.registerModulePath`) but the
			//		the modules which reference them can be unaware of their
			//		relative locations on the filesystem:
			//	|	// somewhere in a configuration block
			//	|	dojo.registerModulePath("acme.widget", "../../acme/widget");
			//	|	dojo.registerModulePath("acme.util", "../../util");
			//	|
			//	|	// ...
			//	|
			//	|	// code in a module using acme resources
			//	|	var tmpltPath = dojo.moduleUrl("acme.widget","templates/template.html");
			//	|	var dataPath = dojo.moduleUrl("acme.util","resources/data.json");

			dojo.deprecated("dojo.moduleUrl()", "use require.toUrl", "2.0");

			// require.toUrl requires a filetype; therefore, just append the suffix "/*.*" to guarantee a filetype, then
			// remove the suffix from the result. This way clients can request a url w/out a filetype. This should be
			// rare, but it maintains backcompat for the v1.x line (note: dojo.moduleUrl will be removed in v2.0).
			// Notice * is an illegal filename so it won't conflict with any real path map that may exist the paths config.
			var result = null;
			if(module){
				result = require.toUrl(module.replace(/\./g, "/") + (url ? ("/" + url) : "") + "/*.*").replace(/\/\*\.\*/, "") + (url ? "" : "/");
			}
			return result;
		};
	}

	dojo._hasResource = {}; // for backward compatibility with layers built with 1.6 tooling

	return dojo;
});

},
'dojo/has':function(){
define(["require", "module"], function(require, module){
	// module:
	//		dojo/has
	// summary:
	//		Defines the has.js API and several feature tests used by dojo.
	// description:
	//		This module defines the has API as described by the project has.js with the following additional features:
	//
	//		- the has test cache is exposed at has.cache.
	//		- the method has.add includes a forth parameter that controls whether or not existing tests are replaced
	//		- the loader's has cache may be optionally copied into this module's has cahce.
	//
	//		This module adopted from https://github.com/phiggins42/has.js; thanks has.js team!

	// try to pull the has implementation from the loader; both the dojo loader and bdLoad provide one
	// if using a foreign loader, then the has cache may be initialized via the config object for this module
	// WARNING: if a foreign loader defines require.has to be something other than the has.js API, then this implementation fail
	var has = require.has || function(){};
	if(! 1 ){
		var
			isBrowser =
				// the most fundamental decision: are we in the browser?
				typeof window != "undefined" &&
				typeof location != "undefined" &&
				typeof document != "undefined" &&
				window.location == location && window.document == document,

			// has API variables
			global = this,
			doc = isBrowser && document,
			element = doc && doc.createElement("DiV"),
			cache = (module.config && module.config()) || {};

		has = function(name){
			// summary:
			//		Return the current value of the named feature.
			//
			// name: String|Integer
			//		The name (if a string) or identifier (if an integer) of the feature to test.
			//
			// description:
			//		Returns the value of the feature named by name. The feature must have been
			//		previously added to the cache by has.add.

			return typeof cache[name] == "function" ? (cache[name] = cache[name](global, doc, element)) : cache[name]; // Boolean
		};

		has.cache = cache;

		has.add = function(name, test, now, force){
			// summary:
			//	 	Register a new feature test for some named feature.
			// name: String|Integer
			//	 	The name (if a string) or identifier (if an integer) of the feature to test.
			// test: Function
			//		 A test function to register. If a function, queued for testing until actually
			//		 needed. The test function should return a boolean indicating
			//	 	the presence of a feature or bug.
			// now: Boolean?
			//		 Optional. Omit if `test` is not a function. Provides a way to immediately
			//		 run the test and cache the result.
			// force: Boolean?
			//	 	Optional. If the test already exists and force is truthy, then the existing
			//	 	test will be replaced; otherwise, add does not replace an existing test (that
			//	 	is, by default, the first test advice wins).
			// example:
			//		A redundant test, testFn with immediate execution:
			//	|	has.add("javascript", function(){ return true; }, true);
			//
			// example:
			//		Again with the redundantness. You can do this in your tests, but we should
			//		not be doing this in any internal has.js tests
			//	|	has.add("javascript", true);
			//
			// example:
			//		Three things are passed to the testFunction. `global`, `document`, and a generic element
			//		from which to work your test should the need arise.
			//	|	has.add("bug-byid", function(g, d, el){
			//	|		// g	== global, typically window, yadda yadda
			//	|		// d	== document object
			//	|		// el == the generic element. a `has` element.
			//	|		return false; // fake test, byid-when-form-has-name-matching-an-id is slightly longer
			//	|	});

			(typeof cache[name]=="undefined" || force) && (cache[name]= test);
			return now && has(name);
		};

		// since we're operating under a loader that doesn't provide a has API, we must explicitly initialize
		// has as it would have otherwise been initialized by the dojo loader; use has.add to the builder
		// can optimize these away iff desired
		 1 || has.add("host-browser", isBrowser);
		 1 || has.add("dom", isBrowser);
		 1 || has.add("dojo-dom-ready-api", 1);
		 0 && has.add("dojo-sniff", 1);
	}

	if( 1 ){
		// Common application level tests
		has.add("dom-addeventlistener", !!document.addEventListener);
		has.add("touch", "ontouchstart" in document);
		// I don't know if any of these tests are really correct, just a rough guess
		has.add("device-width", screen.availWidth || innerWidth);

		// Tests for DOMNode.attributes[] behavior:
		//	 - dom-attributes-explicit - attributes[] only lists explicitly user specified attributes
		//	 - dom-attributes-specified-flag (IE8) - need to check attr.specified flag to skip attributes user didn't specify
		//	 - Otherwise, in IE6-7. attributes[] will list hundreds of values, so need to do outerHTML to get attrs instead.
		var form = document.createElement("form");
		has.add("dom-attributes-explicit", form.attributes.length == 0); // W3C
		has.add("dom-attributes-specified-flag", form.attributes.length > 0 && form.attributes.length < 40);	// IE8
	}

	has.clearElement = function(element){
		// summary:
		//	 Deletes the contents of the element passed to test functions.
		element.innerHTML= "";
		return element;
	};

	has.normalize = function(id, toAbsMid){
		// summary:
		//	 Resolves id into a module id based on possibly-nested tenary expression that branches on has feature test value(s).
		//
		// toAbsMid: Function
		//	 Resolves a relative module id into an absolute module id
		var
			tokens = id.match(/[\?:]|[^:\?]*/g), i = 0,
			get = function(skip){
				var term = tokens[i++];
				if(term == ":"){
					// empty string module name, resolves to 0
					return 0;
				}else{
					// postfixed with a ? means it is a feature to branch on, the term is the name of the feature
					if(tokens[i++] == "?"){
						if(!skip && has(term)){
							// matched the feature, get the first value from the options
							return get();
						}else{
							// did not match, get the second value, passing over the first
							get(true);
							return get(skip);
						}
					}
					// a module
					return term || 0;
				}
			};
		id = get();
		return id && toAbsMid(id);
	};

	has.load = function(id, parentRequire, loaded){
		// summary:
		//		Conditional loading of AMD modules based on a has feature test value.
		// id: String
		//		Gives the resolved module id to load.
		// parentRequire: Function
		//		The loader require function with respect to the module that contained the plugin resource in it's
		//		dependency list.
		// loaded: Function
		//	 Callback to loader that consumes result of plugin demand.

		if(id){
			parentRequire([id], loaded);
		}else{
			loaded();
		}
	};

	return has;
});

},
'dojo/_base/config':function(){
define(["../has", "require"], function(has, require){
	// module:
	//		dojo/_base/config

/*=====
return {
	// summary:
	//		This module defines the user configuration during bootstrap.
	// description:
	//		By defining user configuration as a module value, an entire configuration can be specified in a build,
	//		thereby eliminating the need for sniffing and or explicitly setting in the global variable dojoConfig.
	//		Also, when multiple instances of dojo exist in a single application, each will necessarily be located
	//		at an unique absolute module identifier as given by the package configuration. Implementing configuration
	//		as a module allows for specifying unique, per-instance configurations.
	// example:
	//		Create a second instance of dojo with a different, instance-unique configuration (assume the loader and
	//		dojo.js are already loaded).
	//		|	// specify a configuration that creates a new instance of dojo at the absolute module identifier "myDojo"
	//		|	require({
	//		|		packages:[{
	//		|			name:"myDojo",
	//		|			location:".", //assume baseUrl points to dojo.js
	//		|		}]
	//		|	});
	//		|
	//		|	// specify a configuration for the myDojo instance
	//		|	define("myDojo/config", {
	//		|		// normal configuration variables go here, e.g.,
	//		|		locale:"fr-ca"
	//		|	});
	//		|
	//		|	// load and use the new instance of dojo
	//		|	require(["myDojo"], function(dojo){
	//		|		// dojo is the new instance of dojo
	//		|		// use as required
	//		|	});

	// isDebug: Boolean
	//		Defaults to `false`. If set to `true`, ensures that Dojo provides
	//		extended debugging feedback via Firebug. If Firebug is not available
	//		on your platform, setting `isDebug` to `true` will force Dojo to
	//		pull in (and display) the version of Firebug Lite which is
	//		integrated into the Dojo distribution, thereby always providing a
	//		debugging/logging console when `isDebug` is enabled. Note that
	//		Firebug's `console.*` methods are ALWAYS defined by Dojo. If
	//		`isDebug` is false and you are on a platform without Firebug, these
	//		methods will be defined as no-ops.
	isDebug: false,

	// locale: String
	//		The locale to assume for loading localized resources in this page,
	//		specified according to [RFC 3066](http://www.ietf.org/rfc/rfc3066.txt).
	//		Must be specified entirely in lowercase, e.g. `en-us` and `zh-cn`.
	//		See the documentation for `dojo.i18n` and `dojo.requireLocalization`
	//		for details on loading localized resources. If no locale is specified,
	//		Dojo assumes the locale of the user agent, according to `navigator.userLanguage`
	//		or `navigator.language` properties.
	locale: undefined,

	// extraLocale: Array
	//		No default value. Specifies additional locales whose
	//		resources should also be loaded alongside the default locale when
	//		calls to `dojo.requireLocalization()` are processed.
	extraLocale: undefined,

	// baseUrl: String
	//		The directory in which `dojo.js` is located. Under normal
	//		conditions, Dojo auto-detects the correct location from which it
	//		was loaded. You may need to manually configure `baseUrl` in cases
	//		where you have renamed `dojo.js` or in which `<base>` tags confuse
	//		some browsers (e.g. IE 6). The variable `dojo.baseUrl` is assigned
	//		either the value of `djConfig.baseUrl` if one is provided or the
	//		auto-detected root if not. Other modules are located relative to
	//		this path. The path should end in a slash.
	baseUrl: undefined,

	// modulePaths: [deprecated] Object
	//		A map of module names to paths relative to `dojo.baseUrl`. The
	//		key/value pairs correspond directly to the arguments which
	//		`dojo.registerModulePath` accepts. Specifying
	//		`djConfig.modulePaths = { "foo": "../../bar" }` is the equivalent
	//		of calling `dojo.registerModulePath("foo", "../../bar");`. Multiple
	//		modules may be configured via `djConfig.modulePaths`.
	modulePaths: {},

	// addOnLoad: Function|Array
	//		Adds a callback via dojo/ready. Useful when Dojo is added after
	//		the page loads and djConfig.afterOnLoad is true. Supports the same
	//		arguments as dojo/ready. When using a function reference, use
	//		`djConfig.addOnLoad = function(){};`. For object with function name use
	//		`djConfig.addOnLoad = [myObject, "functionName"];` and for object with
	//		function reference use
	//		`djConfig.addOnLoad = [myObject, function(){}];`
	addOnLoad: null,

	// parseOnLoad: Boolean
	//		Run the parser after the page is loaded
	parseOnLoad: false,

	// require: String[]
	//		An array of module names to be loaded immediately after dojo.js has been included
	//		in a page.
	require: [],

	// defaultDuration: Number
	//		Default duration, in milliseconds, for wipe and fade animations within dijits.
	//		Assigned to dijit.defaultDuration.
	defaultDuration: 200,

	// dojoBlankHtmlUrl: String
	//		Used by some modules to configure an empty iframe. Used by dojo/io/iframe and
	//		dojo/back, and dijit/popup support in IE where an iframe is needed to make sure native
	//		controls do not bleed through the popups. Normally this configuration variable
	//		does not need to be set, except when using cross-domain/CDN Dojo builds.
	//		Save dojo/resources/blank.html to your domain and set `djConfig.dojoBlankHtmlUrl`
	//		to the path on your domain your copy of blank.html.
	dojoBlankHtmlUrl: undefined,

	// ioPublish: Boolean?
	//		Set this to true to enable publishing of topics for the different phases of
	//		IO operations. Publishing is done via dojo/topic.publish(). See dojo/main.__IoPublish for a list
	//		of topics that are published.
	ioPublish: false,

	// useCustomLogger: Anything?
	//		If set to a value that evaluates to true such as a string or array and
	//		isDebug is true and Firebug is not available or running, then it bypasses
	//		the creation of Firebug Lite allowing you to define your own console object.
	useCustomLogger: undefined,

	// transparentColor: Array
	//		Array containing the r, g, b components used as transparent color in dojo.Color;
	//		if undefined, [255,255,255] (white) will be used.
	transparentColor: undefined,
	
	// deps: Function|Array
	//		Defines dependencies to be used before the loader has been loaded.
	//		When provided, they cause the loader to execute require(deps, callback) 
	//		once it has finished loading. Should be used with callback.
	deps: undefined,
	
	// callback: Function|Array
	//		Defines a callback to be used when dependencies are defined before 
	//		the loader has been loaded. When provided, they cause the loader to 
	//		execute require(deps, callback) once it has finished loading. 
	//		Should be used with deps.
	callback: undefined,
	
	// deferredInstrumentation: Boolean
	//		Whether deferred instrumentation should be loaded or included
	//		in builds.
	deferredInstrumentation: true,

	// useDeferredInstrumentation: Boolean|String
	//		Whether the deferred instrumentation should be used.
	//
	//		* `"report-rejections"`: report each rejection as it occurs.
	//		* `true` or `1` or `"report-unhandled-rejections"`: wait 1 second
	//			in an attempt to detect unhandled rejections.
	useDeferredInstrumentation: "report-unhandled-rejections"
};
=====*/

	var result = {};
	if( 1 ){
		// must be the dojo loader; take a shallow copy of require.rawConfig
		var src = require.rawConfig, p;
		for(p in src){
			result[p] = src[p];
		}
	}else{
		var adviseHas = function(featureSet, prefix, booting){
			for(p in featureSet){
				p!="has" && has.add(prefix + p, featureSet[p], 0, booting);
			}
		};
		result =  1  ?
			// must be a built version of the dojo loader; all config stuffed in require.rawConfig
			require.rawConfig :
			// a foreign loader
			this.dojoConfig || this.djConfig || {};
		adviseHas(result, "config", 1);
		adviseHas(result.has, "", 1);
	}
	return result;
});


},
'dojo/domReady':function(){
define(['./has'], function(has){
	var global = this,
		doc = document,
		readyStates = { 'loaded': 1, 'complete': 1 },
		fixReadyState = typeof doc.readyState != "string",
		ready = !!readyStates[doc.readyState];

	// For FF <= 3.5
	if(fixReadyState){ doc.readyState = "loading"; }

	if(!ready){
		var readyQ = [], tests = [],
			detectReady = function(evt){
				evt = evt || global.event;
				if(ready || (evt.type == "readystatechange" && !readyStates[doc.readyState])){ return; }
				ready = 1;

				// For FF <= 3.5
				if(fixReadyState){ doc.readyState = "complete"; }

				while(readyQ.length){
					(readyQ.shift())(doc);
				}
			},
			on = function(node, event){
				node.addEventListener(event, detectReady, false);
				readyQ.push(function(){ node.removeEventListener(event, detectReady, false); });
			};

		if(!has("dom-addeventlistener")){
			on = function(node, event){
				event = "on" + event;
				node.attachEvent(event, detectReady);
				readyQ.push(function(){ node.detachEvent(event, detectReady); });
			};

			var div = doc.createElement("div");
			try{
				if(div.doScroll && global.frameElement === null){
					// the doScroll test is only useful if we're in the top-most frame
					tests.push(function(){
						// Derived with permission from Diego Perini's IEContentLoaded
						// http://javascript.nwbox.com/IEContentLoaded/
						try{
							div.doScroll("left");
							return 1;
						}catch(e){}
					});
				}
			}catch(e){}
		}

		on(doc, "DOMContentLoaded");
		on(global, "load");

		if("onreadystatechange" in doc){
			on(doc, "readystatechange");
		}else if(!fixReadyState){
			// if the ready state property exists and there's
			// no readystatechange event, poll for the state
			// to change
			tests.push(function(){
				return readyStates[doc.readyState];
			});
		}

		if(tests.length){
			var poller = function(){
				if(ready){ return; }
				var i = tests.length;
				while(i--){
					if(tests[i]()){
						detectReady("poller");
						return;
					}
				}
				setTimeout(poller, 30);
			};
			poller();
		}
	}

	function domReady(callback){
		// summary:
		//		Plugin to delay require()/define() callback from firing until the DOM has finished loading.
		if(ready){
			callback(doc);
		}else{
			readyQ.push(callback);
		}
	}
	domReady.load = function(id, req, load){
		domReady(load);
	};

	return domReady;
});

},
'dojo/_base/lang':function(){
define(["./kernel", "../has", "../sniff"], function(dojo, has){
	// module:
	//		dojo/_base/lang

	has.add("bug-for-in-skips-shadowed", function(){
		// if true, the for-in iterator skips object properties that exist in Object's prototype (IE 6 - ?)
		for(var i in {toString: 1}){
			return 0;
		}
		return 1;
	});

	// Helper methods
	var _extraNames =
			has("bug-for-in-skips-shadowed") ?
				"hasOwnProperty.valueOf.isPrototypeOf.propertyIsEnumerable.toLocaleString.toString.constructor".split(".") : [],

		_extraLen = _extraNames.length,

		getProp = function(/*Array*/parts, /*Boolean*/create, /*Object*/context){
			var p, i = 0, dojoGlobal = dojo.global;
			if(!context){
				if(!parts.length){
					return dojoGlobal;
				}else{
					p = parts[i++];
					try{
						context = dojo.scopeMap[p] && dojo.scopeMap[p][1];
					}catch(e){}
					context = context || (p in dojoGlobal ? dojoGlobal[p] : (create ? dojoGlobal[p] = {} : undefined));
				}
			}
			while(context && (p = parts[i++])){
				context = (p in context ? context[p] : (create ? context[p] = {} : undefined));
			}
			return context; // mixed
		},

		opts = Object.prototype.toString,

		efficient = function(obj, offset, startWith){
			return (startWith||[]).concat(Array.prototype.slice.call(obj, offset||0));
		},

		_pattern = /\{([^\}]+)\}/g;

	// Module export
	var lang = {
		// summary:
		//		This module defines Javascript language extensions.

		// _extraNames: String[]
		//		Lists property names that must be explicitly processed during for-in iteration
		//		in environments that have has("bug-for-in-skips-shadowed") true.
		_extraNames:_extraNames,

		_mixin: function(dest, source, copyFunc){
			// summary:
			//		Copies/adds all properties of source to dest; returns dest.
			// dest: Object
			//		The object to which to copy/add all properties contained in source.
			// source: Object
			//		The object from which to draw all properties to copy into dest.
			// copyFunc: Function?
			//		The process used to copy/add a property in source; defaults to the Javascript assignment operator.
			// returns:
			//		dest, as modified
			// description:
			//		All properties, including functions (sometimes termed "methods"), excluding any non-standard extensions
			//		found in Object.prototype, are copied/added to dest. Copying/adding each particular property is
			//		delegated to copyFunc (if any); copyFunc defaults to the Javascript assignment operator if not provided.
			//		Notice that by default, _mixin executes a so-called "shallow copy" and aggregate types are copied/added by reference.
			var name, s, i, empty = {};
			for(name in source){
				// the (!(name in empty) || empty[name] !== s) condition avoids copying properties in "source"
				// inherited from Object.prototype.	 For example, if dest has a custom toString() method,
				// don't overwrite it with the toString() method that source inherited from Object.prototype
				s = source[name];
				if(!(name in dest) || (dest[name] !== s && (!(name in empty) || empty[name] !== s))){
					dest[name] = copyFunc ? copyFunc(s) : s;
				}
			}

			if(has("bug-for-in-skips-shadowed")){
				if(source){
					for(i = 0; i < _extraLen; ++i){
						name = _extraNames[i];
						s = source[name];
						if(!(name in dest) || (dest[name] !== s && (!(name in empty) || empty[name] !== s))){
							dest[name] = copyFunc ? copyFunc(s) : s;
						}
					}
				}
			}

			return dest; // Object
		},

		mixin: function(dest, sources){
			// summary:
			//		Copies/adds all properties of one or more sources to dest; returns dest.
			// dest: Object
			//		The object to which to copy/add all properties contained in source. If dest is falsy, then
			//		a new object is manufactured before copying/adding properties begins.
			// sources: Object...
			//		One of more objects from which to draw all properties to copy into dest. sources are processed
			//		left-to-right and if more than one of these objects contain the same property name, the right-most
			//		value "wins".
			// returns: Object
			//		dest, as modified
			// description:
			//		All properties, including functions (sometimes termed "methods"), excluding any non-standard extensions
			//		found in Object.prototype, are copied/added from sources to dest. sources are processed left to right.
			//		The Javascript assignment operator is used to copy/add each property; therefore, by default, mixin
			//		executes a so-called "shallow copy" and aggregate types are copied/added by reference.
			// example:
			//		make a shallow copy of an object
			//	|	var copy = lang.mixin({}, source);
			// example:
			//		many class constructors often take an object which specifies
			//		values to be configured on the object. In this case, it is
			//		often simplest to call `lang.mixin` on the `this` object:
			//	|	declare("acme.Base", null, {
			//	|		constructor: function(properties){
			//	|			// property configuration:
			//	|			lang.mixin(this, properties);
			//	|
			//	|			0 && console.log(this.quip);
			//	|			//	...
			//	|		},
			//	|		quip: "I wasn't born yesterday, you know - I've seen movies.",
			//	|		// ...
			//	|	});
			//	|
			//	|	// create an instance of the class and configure it
			//	|	var b = new acme.Base({quip: "That's what it does!" });
			// example:
			//		copy in properties from multiple objects
			//	|	var flattened = lang.mixin(
			//	|		{
			//	|			name: "Frylock",
			//	|			braces: true
			//	|		},
			//	|		{
			//	|			name: "Carl Brutanananadilewski"
			//	|		}
			//	|	);
			//	|
			//	|	// will print "Carl Brutanananadilewski"
			//	|	0 && console.log(flattened.name);
			//	|	// will print "true"
			//	|	0 && console.log(flattened.braces);

			if(!dest){ dest = {}; }
			for(var i = 1, l = arguments.length; i < l; i++){
				lang._mixin(dest, arguments[i]);
			}
			return dest; // Object
		},

		setObject: function(name, value, context){
			// summary:
			//		Set a property from a dot-separated string, such as "A.B.C"
			// description:
			//		Useful for longer api chains where you have to test each object in
			//		the chain, or when you have an object reference in string format.
			//		Objects are created as needed along `path`. Returns the passed
			//		value if setting is successful or `undefined` if not.
			// name: String
			//		Path to a property, in the form "A.B.C".
			// value: anything
			//		value or object to place at location given by name
			// context: Object?
			//		Optional. Object to use as root of path. Defaults to
			//		`dojo.global`.
			// example:
			//		set the value of `foo.bar.baz`, regardless of whether
			//		intermediate objects already exist:
			//	| lang.setObject("foo.bar.baz", value);
			// example:
			//		without `lang.setObject`, we often see code like this:
			//	| // ensure that intermediate objects are available
			//	| if(!obj["parent"]){ obj.parent = {}; }
			//	| if(!obj.parent["child"]){ obj.parent.child = {}; }
			//	| // now we can safely set the property
			//	| obj.parent.child.prop = "some value";
			//		whereas with `lang.setObject`, we can shorten that to:
			//	| lang.setObject("parent.child.prop", "some value", obj);

			var parts = name.split("."), p = parts.pop(), obj = getProp(parts, true, context);
			return obj && p ? (obj[p] = value) : undefined; // Object
		},

		getObject: function(name, create, context){
			// summary:
			//		Get a property from a dot-separated string, such as "A.B.C"
			// description:
			//		Useful for longer api chains where you have to test each object in
			//		the chain, or when you have an object reference in string format.
			// name: String
			//		Path to an property, in the form "A.B.C".
			// create: Boolean?
			//		Optional. Defaults to `false`. If `true`, Objects will be
			//		created at any point along the 'path' that is undefined.
			// context: Object?
			//		Optional. Object to use as root of path. Defaults to
			//		'dojo.global'. Null may be passed.
			return getProp(name.split("."), create, context); // Object
		},

		exists: function(name, obj){
			// summary:
			//		determine if an object supports a given method
			// description:
			//		useful for longer api chains where you have to test each object in
			//		the chain. Useful for object and method detection.
			// name: String
			//		Path to an object, in the form "A.B.C".
			// obj: Object?
			//		Object to use as root of path. Defaults to
			//		'dojo.global'. Null may be passed.
			// example:
			//	| // define an object
			//	| var foo = {
			//	|		bar: { }
			//	| };
			//	|
			//	| // search the global scope
			//	| lang.exists("foo.bar"); // true
			//	| lang.exists("foo.bar.baz"); // false
			//	|
			//	| // search from a particular scope
			//	| lang.exists("bar", foo); // true
			//	| lang.exists("bar.baz", foo); // false
			return lang.getObject(name, false, obj) !== undefined; // Boolean
		},

		// Crockford (ish) functions

		isString: function(it){
			// summary:
			//		Return true if it is a String
			// it: anything
			//		Item to test.
			return (typeof it == "string" || it instanceof String); // Boolean
		},

		isArray: function(it){
			// summary:
			//		Return true if it is an Array.
			//		Does not work on Arrays created in other windows.
			// it: anything
			//		Item to test.
			return it && (it instanceof Array || typeof it == "array"); // Boolean
		},

		isFunction: function(it){
			// summary:
			//		Return true if it is a Function
			// it: anything
			//		Item to test.
			return opts.call(it) === "[object Function]";
		},

		isObject: function(it){
			// summary:
			//		Returns true if it is a JavaScript object (or an Array, a Function
			//		or null)
			// it: anything
			//		Item to test.
			return it !== undefined &&
				(it === null || typeof it == "object" || lang.isArray(it) || lang.isFunction(it)); // Boolean
		},

		isArrayLike: function(it){
			// summary:
			//		similar to isArray() but more permissive
			// it: anything
			//		Item to test.
			// returns:
			//		If it walks like a duck and quacks like a duck, return `true`
			// description:
			//		Doesn't strongly test for "arrayness".  Instead, settles for "isn't
			//		a string or number and has a length property". Arguments objects
			//		and DOM collections will return true when passed to
			//		isArrayLike(), but will return false when passed to
			//		isArray().
			return it && it !== undefined && // Boolean
				// keep out built-in constructors (Number, String, ...) which have length
				// properties
				!lang.isString(it) && !lang.isFunction(it) &&
				!(it.tagName && it.tagName.toLowerCase() == 'form') &&
				(lang.isArray(it) || isFinite(it.length));
		},

		isAlien: function(it){
			// summary:
			//		Returns true if it is a built-in function or some other kind of
			//		oddball that *should* report as a function but doesn't
			return it && !lang.isFunction(it) && /\{\s*\[native code\]\s*\}/.test(String(it)); // Boolean
		},

		extend: function(ctor, props){
			// summary:
			//		Adds all properties and methods of props to constructor's
			//		prototype, making them available to all instances created with
			//		constructor.
			// ctor: Object
			//		Target constructor to extend.
			// props: Object
			//		One or more objects to mix into ctor.prototype
			for(var i=1, l=arguments.length; i<l; i++){
				lang._mixin(ctor.prototype, arguments[i]);
			}
			return ctor; // Object
		},

		_hitchArgs: function(scope, method){
			var pre = lang._toArray(arguments, 2);
			var named = lang.isString(method);
			return function(){
				// arrayify arguments
				var args = lang._toArray(arguments);
				// locate our method
				var f = named ? (scope||dojo.global)[method] : method;
				// invoke with collected args
				return f && f.apply(scope || this, pre.concat(args)); // mixed
			}; // Function
		},

		hitch: function(scope, method){
			// summary:
			//		Returns a function that will only ever execute in the a given scope.
			//		This allows for easy use of object member functions
			//		in callbacks and other places in which the "this" keyword may
			//		otherwise not reference the expected scope.
			//		Any number of default positional arguments may be passed as parameters
			//		beyond "method".
			//		Each of these values will be used to "placehold" (similar to curry)
			//		for the hitched function.
			// scope: Object
			//		The scope to use when method executes. If method is a string,
			//		scope is also the object containing method.
			// method: Function|String...
			//		A function to be hitched to scope, or the name of the method in
			//		scope to be hitched.
			// example:
			//	|	lang.hitch(foo, "bar")();
			//		runs foo.bar() in the scope of foo
			// example:
			//	|	lang.hitch(foo, myFunction);
			//		returns a function that runs myFunction in the scope of foo
			// example:
			//		Expansion on the default positional arguments passed along from
			//		hitch. Passed args are mixed first, additional args after.
			//	|	var foo = { bar: function(a, b, c){ 0 && console.log(a, b, c); } };
			//	|	var fn = lang.hitch(foo, "bar", 1, 2);
			//	|	fn(3); // logs "1, 2, 3"
			// example:
			//	|	var foo = { bar: 2 };
			//	|	lang.hitch(foo, function(){ this.bar = 10; })();
			//		execute an anonymous function in scope of foo
			if(arguments.length > 2){
				return lang._hitchArgs.apply(dojo, arguments); // Function
			}
			if(!method){
				method = scope;
				scope = null;
			}
			if(lang.isString(method)){
				scope = scope || dojo.global;
				if(!scope[method]){ throw(['lang.hitch: scope["', method, '"] is null (scope="', scope, '")'].join('')); }
				return function(){ return scope[method].apply(scope, arguments || []); }; // Function
			}
			return !scope ? method : function(){ return method.apply(scope, arguments || []); }; // Function
		},

		delegate: (function(){
			// boodman/crockford delegation w/ cornford optimization
			function TMP(){}
			return function(obj, props){
				TMP.prototype = obj;
				var tmp = new TMP();
				TMP.prototype = null;
				if(props){
					lang._mixin(tmp, props);
				}
				return tmp; // Object
			};
		})(),
		/*=====
		delegate: function(obj, props){
			// summary:
			//		Returns a new object which "looks" to obj for properties which it
			//		does not have a value for. Optionally takes a bag of properties to
			//		seed the returned object with initially.
			// description:
			//		This is a small implementation of the Boodman/Crockford delegation
			//		pattern in JavaScript. An intermediate object constructor mediates
			//		the prototype chain for the returned object, using it to delegate
			//		down to obj for property lookup when object-local lookup fails.
			//		This can be thought of similarly to ES4's "wrap", save that it does
			//		not act on types but rather on pure objects.
			// obj: Object
			//		The object to delegate to for properties not found directly on the
			//		return object or in props.
			// props: Object...
			//		an object containing properties to assign to the returned object
			// returns:
			//		an Object of anonymous type
			// example:
			//	|	var foo = { bar: "baz" };
			//	|	var thinger = lang.delegate(foo, { thud: "xyzzy"});
			//	|	thinger.bar == "baz"; // delegated to foo
			//	|	foo.thud == undefined; // by definition
			//	|	thinger.thud == "xyzzy"; // mixed in from props
			//	|	foo.bar = "thonk";
			//	|	thinger.bar == "thonk"; // still delegated to foo's bar
		},
		=====*/

		_toArray: has("ie") ?
			(function(){
				function slow(obj, offset, startWith){
					var arr = startWith||[];
					for(var x = offset || 0; x < obj.length; x++){
						arr.push(obj[x]);
					}
					return arr;
				}
				return function(obj){
					return ((obj.item) ? slow : efficient).apply(this, arguments);
				};
			})() : efficient,
		/*=====
		 _toArray: function(obj, offset, startWith){
			 // summary:
			 //		Converts an array-like object (i.e. arguments, DOMCollection) to an
			 //		array. Returns a new Array with the elements of obj.
			 // obj: Object
			 //		the object to "arrayify". We expect the object to have, at a
			 //		minimum, a length property which corresponds to integer-indexed
			 //		properties.
			 // offset: Number?
			 //		the location in obj to start iterating from. Defaults to 0.
			 //		Optional.
			 // startWith: Array?
			 //		An array to pack with the properties of obj. If provided,
			 //		properties in obj are appended at the end of startWith and
			 //		startWith is the returned array.
		 },
		 =====*/

		partial: function(/*Function|String*/ method /*, ...*/){
			// summary:
			//		similar to hitch() except that the scope object is left to be
			//		whatever the execution context eventually becomes.
			// description:
			//		Calling lang.partial is the functional equivalent of calling:
			//		|	lang.hitch(null, funcName, ...);
			// method:
			//		The function to "wrap"
			var arr = [ null ];
			return lang.hitch.apply(dojo, arr.concat(lang._toArray(arguments))); // Function
		},

		clone: function(/*anything*/ src){
			// summary:
			//		Clones objects (including DOM nodes) and all children.
			//		Warning: do not clone cyclic structures.
			// src:
			//		The object to clone
			if(!src || typeof src != "object" || lang.isFunction(src)){
				// null, undefined, any non-object, or function
				return src;	// anything
			}
			if(src.nodeType && "cloneNode" in src){
				// DOM Node
				return src.cloneNode(true); // Node
			}
			if(src instanceof Date){
				// Date
				return new Date(src.getTime());	// Date
			}
			if(src instanceof RegExp){
				// RegExp
				return new RegExp(src);   // RegExp
			}
			var r, i, l;
			if(lang.isArray(src)){
				// array
				r = [];
				for(i = 0, l = src.length; i < l; ++i){
					if(i in src){
						r.push(lang.clone(src[i]));
					}
				}
				// we don't clone functions for performance reasons
				//		}else if(d.isFunction(src)){
				//			// function
				//			r = function(){ return src.apply(this, arguments); };
			}else{
				// generic objects
				r = src.constructor ? new src.constructor() : {};
			}
			return lang._mixin(r, src, lang.clone);
		},


		trim: String.prototype.trim ?
			function(str){ return str.trim(); } :
			function(str){ return str.replace(/^\s\s*/, '').replace(/\s\s*$/, ''); },
		/*=====
		 trim: function(str){
			 // summary:
			 //		Trims whitespace from both sides of the string
			 // str: String
			 //		String to be trimmed
			 // returns: String
			 //		Returns the trimmed string
			 // description:
			 //		This version of trim() was selected for inclusion into the base due
			 //		to its compact size and relatively good performance
			 //		(see [Steven Levithan's blog](http://blog.stevenlevithan.com/archives/faster-trim-javascript)
			 //		Uses String.prototype.trim instead, if available.
			 //		The fastest but longest version of this function is located at
			 //		lang.string.trim()
		 },
		 =====*/

		replace: function(tmpl, map, pattern){
			// summary:
			//		Performs parameterized substitutions on a string. Throws an
			//		exception if any parameter is unmatched.
			// tmpl: String
			//		String to be used as a template.
			// map: Object|Function
			//		If an object, it is used as a dictionary to look up substitutions.
			//		If a function, it is called for every substitution with following parameters:
			//		a whole match, a name, an offset, and the whole template
			//		string (see https://developer.mozilla.org/en/Core_JavaScript_1.5_Reference/Global_Objects/String/replace
			//		for more details).
			// pattern: RegEx?
			//		Optional regular expression objects that overrides the default pattern.
			//		Must be global and match one item. The default is: /\{([^\}]+)\}/g,
			//		which matches patterns like that: "{xxx}", where "xxx" is any sequence
			//		of characters, which doesn't include "}".
			// returns: String
			//		Returns the substituted string.
			// example:
			//	|	// uses a dictionary for substitutions:
			//	|	lang.replace("Hello, {name.first} {name.last} AKA {nick}!",
			//	|		{
			//	|			nick: "Bob",
			//	|			name: {
			//	|				first:	"Robert",
			//	|				middle: "X",
			//	|				last:		"Cringely"
			//	|			}
			//	|		});
			//	|	// returns: Hello, Robert Cringely AKA Bob!
			// example:
			//	|	// uses an array for substitutions:
			//	|	lang.replace("Hello, {0} {2}!",
			//	|		["Robert", "X", "Cringely"]);
			//	|	// returns: Hello, Robert Cringely!
			// example:
			//	|	// uses a function for substitutions:
			//	|	function sum(a){
			//	|		var t = 0;
			//	|		arrayforEach(a, function(x){ t += x; });
			//	|		return t;
			//	|	}
			//	|	lang.replace(
			//	|		"{count} payments averaging {avg} USD per payment.",
			//	|		lang.hitch(
			//	|			{ payments: [11, 16, 12] },
			//	|			function(_, key){
			//	|				switch(key){
			//	|					case "count": return this.payments.length;
			//	|					case "min":		return Math.min.apply(Math, this.payments);
			//	|					case "max":		return Math.max.apply(Math, this.payments);
			//	|					case "sum":		return sum(this.payments);
			//	|					case "avg":		return sum(this.payments) / this.payments.length;
			//	|				}
			//	|			}
			//	|		)
			//	|	);
			//	|	// prints: 3 payments averaging 13 USD per payment.
			// example:
			//	|	// uses an alternative PHP-like pattern for substitutions:
			//	|	lang.replace("Hello, ${0} ${2}!",
			//	|		["Robert", "X", "Cringely"], /\$\{([^\}]+)\}/g);
			//	|	// returns: Hello, Robert Cringely!

			return tmpl.replace(pattern || _pattern, lang.isFunction(map) ?
				map : function(_, k){ return lang.getObject(k, false, map); });
		}
	};

	 1  && lang.mixin(dojo, lang);

	return lang;
});


},
'dojo/sniff':function(){
define(["./has"], function(has){
	// module:
	//		dojo/sniff

	/*=====
	return function(){
		// summary:
		//		This module sets has() flags based on the current browser.
		//		It returns the has() function.
	};
	=====*/

	if( 1 ){
		var n = navigator,
			dua = n.userAgent,
			dav = n.appVersion,
			tv = parseFloat(dav);

		has.add("air", dua.indexOf("AdobeAIR") >= 0),
		has.add("khtml", dav.indexOf("Konqueror") >= 0 ? tv : undefined);
		has.add("webkit", parseFloat(dua.split("WebKit/")[1]) || undefined);
		has.add("chrome", parseFloat(dua.split("Chrome/")[1]) || undefined);
		has.add("safari", dav.indexOf("Safari")>=0 && !has("chrome") ? parseFloat(dav.split("Version/")[1]) : undefined);
		has.add("mac", dav.indexOf("Macintosh") >= 0);
		 0 && has.add("quirks", document.compatMode == "BackCompat");
		has.add("ios", /iPhone|iPod|iPad/.test(dua));
		has.add("android", parseFloat(dua.split("Android ")[1]) || undefined);

		if(!has("webkit")){
			// Opera
			if(dua.indexOf("Opera") >= 0){
				// see http://dev.opera.com/articles/view/opera-ua-string-changes and http://www.useragentstring.com/pages/Opera/
				// 9.8 has both styles; <9.8, 9.9 only old style
				 0 && has.add("opera", tv >= 9.8 ? parseFloat(dua.split("Version/")[1]) || tv : tv);
			}

			// Mozilla and firefox
			if(dua.indexOf("Gecko") >= 0 && !has("khtml") && !has("webkit")){
				has.add("mozilla", tv);
			}
			if(has("mozilla")){
				//We really need to get away from this. Consider a sane isGecko approach for the future.
				has.add("ff", parseFloat(dua.split("Firefox/")[1] || dua.split("Minefield/")[1]) || undefined);
			}

			// IE
			if(document.all && ! 0 ){
				var isIE = parseFloat(dav.split("MSIE ")[1]) || undefined;

				//In cases where the page has an HTTP header or META tag with
				//X-UA-Compatible, then it is in emulation mode.
				//Make sure isIE reflects the desired version.
				//document.documentMode of 5 means quirks mode.
				//Only switch the value if documentMode's major version
				//is different from isIE's major version.
				var mode = document.documentMode;
				if(mode && mode != 5 && Math.floor(isIE) != mode){
					isIE = mode;
				}

				has.add("ie", isIE);
			}

			// Wii
			has.add("wii", typeof opera != "undefined" && opera.wiiremote);
		}
	}

	return has;
});

},
'dojox/mobile/parser':function(){
define([
	"dojo/_base/kernel",
	"dojo/_base/array",
	"dojo/_base/config",
	"dojo/_base/lang",
	"dojo/_base/window",
	"dojo/ready"
], function(dojo, array, config, lang, win, ready){

	// module:
	//		dojox/mobile/parser

	var dm = lang.getObject("dojox.mobile", true);

	var Parser = function(){
		// summary:
		//		A lightweight parser.
		// description:
		//		dojox/mobile/parser is an extremely small subset of dojo/parser.
		//		It has no additional features over dojo/parser, so there is no
		//		benefit in terms of features by using dojox/mobile/parser instead 
		//		of dojo/parser.	However, if dojox/mobile/parser's capabilities are
		//		enough for your	application, using it could reduce the total code size.

		var _ctorMap = {};
		var getCtor = function(type, mixins){
			if(typeof(mixins) === "string"){
				var t = type + ":" + mixins.replace(/ /g, "");
				return _ctorMap[t] ||
					(_ctorMap[t] = getCtor(type).createSubclass(array.map(mixins.split(/, */), getCtor)));
			}
			return _ctorMap[type] || (_ctorMap[type] = lang.getObject(type) || require(type));
		};
		var _eval = function(js){ return eval(js); };

		this.instantiate = function(/* DomNode[] */nodes, /* Object? */mixin, /* Object? */options){
			// summary:
			//		Function for instantiating a list of widget nodes.
			// nodes:
			//		The list of DomNodes to walk and instantiate widgets on.
			mixin = mixin || {};
			options = options || {};
			var i, ws = [];
			if(nodes){
				for(i = 0; i < nodes.length; i++){
					var n = nodes[i],
						type = n._type,
						ctor = getCtor(type, n.getAttribute("data-dojo-mixins")),
						proto = ctor.prototype,
						params = {}, prop, v, t;
					lang.mixin(params, _eval.call(options.propsThis, '({'+(n.getAttribute("data-dojo-props")||"")+'})'));
					lang.mixin(params, options.defaults);
					lang.mixin(params, mixin);
					for(prop in proto){
						v = n.getAttributeNode(prop);
						v = v && v.nodeValue;
						t = typeof proto[prop];
						if(!v && (t !== "boolean" || v !== "")){ continue; }
						if(lang.isArray(proto[prop])){
							params[prop] = v.split(/\s*,\s*/);
						}else if(t === "string"){
							params[prop] = v;
						}else if(t === "number"){
							params[prop] = v - 0;
						}else if(t === "boolean"){
							params[prop] = (v !== "false");
						}else if(t === "object"){
							params[prop] = eval("(" + v + ")");
						}else if(t === "function"){
							params[prop] = lang.getObject(v, false) || new Function(v);
							n.removeAttribute(prop);
						}
					}
					params["class"] = n.className;
					if(!params.style){ params.style = n.style.cssText; }
					v = n.getAttribute("data-dojo-attach-point");
					if(v){ params.dojoAttachPoint = v; }
					v = n.getAttribute("data-dojo-attach-event");
					if(v){ params.dojoAttachEvent = v; }
					var instance = new ctor(params, n);
					ws.push(instance);
					var jsId = n.getAttribute("jsId") || n.getAttribute("data-dojo-id");
					if(jsId){
						lang.setObject(jsId, instance);
					}
				}
				for(i = 0; i < ws.length; i++){
					var w = ws[i];
					!options.noStart && w.startup && !w._started && w.startup();
				}
			}
			return ws;
		};

		this.parse = function(/* DomNode */ rootNode, /* Object? */ options){
			// summary:
			//		Function to handle parsing for widgets in the current document.
			//		It is not as powerful as the full parser, but it will handle basic
			//		use cases fine.
			// rootNode:
			//		The root node in the document to parse from
			if(!rootNode){
				rootNode = win.body();
			}else if(!options && rootNode.rootNode){
				// Case where 'rootNode' is really a params object.
				options = rootNode;
				rootNode = rootNode.rootNode;
			}

			var nodes = rootNode.getElementsByTagName("*");
			var i, j, list = [];
			for(i = 0; i < nodes.length; i++){
				var n = nodes[i],
					type = (n._type = n.getAttribute("dojoType") || n.getAttribute("data-dojo-type"));
				if(type){
					if(n._skip){
						n._skip = "";
						continue;
					}
					if(getCtor(type).prototype.stopParser && !(options && options.template)){
						var arr = n.getElementsByTagName("*");
						for(j = 0; j < arr.length; j++){
							arr[j]._skip = "1";
						}
					}
					list.push(n);
				}
			}
			var mixin = options && options.template ? {template: true} : null;
			return this.instantiate(list, mixin, options);
		};
	};

	// Singleton.   (TODO: replace parser class and singleton w/a simple hash of functions)
	var parser = new Parser();

	if(config.parseOnLoad){
		ready(100, function(){
			// Now that all the modules are loaded, check if the app loaded dojo/parser too.
			// If it did, let dojo/parser handle the parseOnLoad flag instead of me.
			try{
				if(!require("dojo/parser")){
					// IE6 takes this path when dojo/parser unavailable, rather than catch() block below,
					// due to http://support.microsoft.com/kb/944397
					parser.parse();
				}
			}catch(e){
				// Other browsers (and later versions of IE) take this path when dojo/parser unavailable
				parser.parse();
			}
		});
	}
	dm.parser = parser; // for backward compatibility
	dojo.parser = dojo.parser || parser; // in case user application calls dojo.parser

	return parser;
});

},
'dojo/_base/array':function(){
define(["./kernel", "../has", "./lang"], function(dojo, has, lang){
	// module:
	//		dojo/_base/array

	// our old simple function builder stuff
	var cache = {}, u;

	function buildFn(fn){
		return cache[fn] = new Function("item", "index", "array", fn); // Function
	}
	// magic snippet: if(typeof fn == "string") fn = cache[fn] || buildFn(fn);

	// every & some

	function everyOrSome(some){
		var every = !some;
		return function(a, fn, o){
			var i = 0, l = a && a.length || 0, result;
			if(l && typeof a == "string") a = a.split("");
			if(typeof fn == "string") fn = cache[fn] || buildFn(fn);
			if(o){
				for(; i < l; ++i){
					result = !fn.call(o, a[i], i, a);
					if(some ^ result){
						return !result;
					}
				}
			}else{
				for(; i < l; ++i){
					result = !fn(a[i], i, a);
					if(some ^ result){
						return !result;
					}
				}
			}
			return every; // Boolean
		};
	}

	// indexOf, lastIndexOf

	function index(up){
		var delta = 1, lOver = 0, uOver = 0;
		if(!up){
			delta = lOver = uOver = -1;
		}
		return function(a, x, from, last){
			if(last && delta > 0){
				// TODO: why do we use a non-standard signature? why do we need "last"?
				return array.lastIndexOf(a, x, from);
			}
			var l = a && a.length || 0, end = up ? l + uOver : lOver, i;
			if(from === u){
				i = up ? lOver : l + uOver;
			}else{
				if(from < 0){
					i = l + from;
					if(i < 0){
						i = lOver;
					}
				}else{
					i = from >= l ? l + uOver : from;
				}
			}
			if(l && typeof a == "string") a = a.split("");
			for(; i != end; i += delta){
				if(a[i] == x){
					return i; // Number
				}
			}
			return -1; // Number
		};
	}

	var array = {
		// summary:
		//		The Javascript v1.6 array extensions.

		every: everyOrSome(false),
		/*=====
		 every: function(arr, callback, thisObject){
			 // summary:
			 //		Determines whether or not every item in arr satisfies the
			 //		condition implemented by callback.
			 // arr: Array|String
			 //		the array to iterate on. If a string, operates on individual characters.
			 // callback: Function|String
			 //		a function is invoked with three arguments: item, index,
			 //		and array and returns true if the condition is met.
			 // thisObject: Object?
			 //		may be used to scope the call to callback
			 // returns: Boolean
			 // description:
			 //		This function corresponds to the JavaScript 1.6 Array.every() method, with one difference: when
			 //		run over sparse arrays, this implementation passes the "holes" in the sparse array to
			 //		the callback function with a value of undefined. JavaScript 1.6's every skips the holes in the sparse array.
			 //		For more details, see:
			 //		https://developer.mozilla.org/en/Core_JavaScript_1.5_Reference/Objects/Array/every
			 // example:
			 //	|	// returns false
			 //	|	array.every([1, 2, 3, 4], function(item){ return item>1; });
			 // example:
			 //	|	// returns true
			 //	|	array.every([1, 2, 3, 4], function(item){ return item>0; });
		 },
		 =====*/

		some: everyOrSome(true),
		/*=====
		some: function(arr, callback, thisObject){
			// summary:
			//		Determines whether or not any item in arr satisfies the
			//		condition implemented by callback.
			// arr: Array|String
			//		the array to iterate over. If a string, operates on individual characters.
			// callback: Function|String
			//		a function is invoked with three arguments: item, index,
			//		and array and returns true if the condition is met.
			// thisObject: Object?
			//		may be used to scope the call to callback
			// returns: Boolean
			// description:
			//		This function corresponds to the JavaScript 1.6 Array.some() method, with one difference: when
			//		run over sparse arrays, this implementation passes the "holes" in the sparse array to
			//		the callback function with a value of undefined. JavaScript 1.6's some skips the holes in the sparse array.
			//		For more details, see:
			//		https://developer.mozilla.org/en/Core_JavaScript_1.5_Reference/Objects/Array/some
			// example:
			//	| // is true
			//	| array.some([1, 2, 3, 4], function(item){ return item>1; });
			// example:
			//	| // is false
			//	| array.some([1, 2, 3, 4], function(item){ return item<1; });
		},
		=====*/

		indexOf: index(true),
		/*=====
		indexOf: function(arr, value, fromIndex, findLast){
			// summary:
			//		locates the first index of the provided value in the
			//		passed array. If the value is not found, -1 is returned.
			// description:
			//		This method corresponds to the JavaScript 1.6 Array.indexOf method, with one difference: when
			//		run over sparse arrays, the Dojo function invokes the callback for every index whereas JavaScript
			//		1.6's indexOf skips the holes in the sparse array.
			//		For details on this method, see:
			//		https://developer.mozilla.org/en/Core_JavaScript_1.5_Reference/Objects/Array/indexOf
			// arr: Array
			// value: Object
			// fromIndex: Integer?
			// findLast: Boolean?
			// returns: Number
		},
		=====*/

		lastIndexOf: index(false),
		/*=====
		lastIndexOf: function(arr, value, fromIndex){
			// summary:
			//		locates the last index of the provided value in the passed
			//		array. If the value is not found, -1 is returned.
			// description:
			//		This method corresponds to the JavaScript 1.6 Array.lastIndexOf method, with one difference: when
			//		run over sparse arrays, the Dojo function invokes the callback for every index whereas JavaScript
			//		1.6's lastIndexOf skips the holes in the sparse array.
			//		For details on this method, see:
			//		https://developer.mozilla.org/en/Core_JavaScript_1.5_Reference/Objects/Array/lastIndexOf
			// arr: Array,
			// value: Object,
			// fromIndex: Integer?
			// returns: Number
		},
		=====*/

		forEach: function(arr, callback, thisObject){
			// summary:
			//		for every item in arr, callback is invoked. Return values are ignored.
			//		If you want to break out of the loop, consider using array.every() or array.some().
			//		forEach does not allow breaking out of the loop over the items in arr.
			// arr:
			//		the array to iterate over. If a string, operates on individual characters.
			// callback:
			//		a function is invoked with three arguments: item, index, and array
			// thisObject:
			//		may be used to scope the call to callback
			// description:
			//		This function corresponds to the JavaScript 1.6 Array.forEach() method, with one difference: when
			//		run over sparse arrays, this implementation passes the "holes" in the sparse array to
			//		the callback function with a value of undefined. JavaScript 1.6's forEach skips the holes in the sparse array.
			//		For more details, see:
			//		https://developer.mozilla.org/en/Core_JavaScript_1.5_Reference/Objects/Array/forEach
			// example:
			//	| // log out all members of the array:
			//	| array.forEach(
			//	|		[ "thinger", "blah", "howdy", 10 ],
			//	|		function(item){
			//	|			0 && console.log(item);
			//	|		}
			//	| );
			// example:
			//	| // log out the members and their indexes
			//	| array.forEach(
			//	|		[ "thinger", "blah", "howdy", 10 ],
			//	|		function(item, idx, arr){
			//	|			0 && console.log(item, "at index:", idx);
			//	|		}
			//	| );
			// example:
			//	| // use a scoped object member as the callback
			//	|
			//	| var obj = {
			//	|		prefix: "logged via obj.callback:",
			//	|		callback: function(item){
			//	|			0 && console.log(this.prefix, item);
			//	|		}
			//	| };
			//	|
			//	| // specifying the scope function executes the callback in that scope
			//	| array.forEach(
			//	|		[ "thinger", "blah", "howdy", 10 ],
			//	|		obj.callback,
			//	|		obj
			//	| );
			//	|
			//	| // alternately, we can accomplish the same thing with lang.hitch()
			//	| array.forEach(
			//	|		[ "thinger", "blah", "howdy", 10 ],
			//	|		lang.hitch(obj, "callback")
			//	| );
			// arr: Array|String
			// callback: Function|String
			// thisObject: Object?

			var i = 0, l = arr && arr.length || 0;
			if(l && typeof arr == "string") arr = arr.split("");
			if(typeof callback == "string") callback = cache[callback] || buildFn(callback);
			if(thisObject){
				for(; i < l; ++i){
					callback.call(thisObject, arr[i], i, arr);
				}
			}else{
				for(; i < l; ++i){
					callback(arr[i], i, arr);
				}
			}
		},

		map: function(arr, callback, thisObject, Ctr){
			// summary:
			//		applies callback to each element of arr and returns
			//		an Array with the results
			// arr: Array|String
			//		the array to iterate on. If a string, operates on
			//		individual characters.
			// callback: Function|String
			//		a function is invoked with three arguments, (item, index,
			//		array),	 and returns a value
			// thisObject: Object?
			//		may be used to scope the call to callback
			// returns: Array
			// description:
			//		This function corresponds to the JavaScript 1.6 Array.map() method, with one difference: when
			//		run over sparse arrays, this implementation passes the "holes" in the sparse array to
			//		the callback function with a value of undefined. JavaScript 1.6's map skips the holes in the sparse array.
			//		For more details, see:
			//		https://developer.mozilla.org/en/Core_JavaScript_1.5_Reference/Objects/Array/map
			// example:
			//	| // returns [2, 3, 4, 5]
			//	| array.map([1, 2, 3, 4], function(item){ return item+1 });

			// TODO: why do we have a non-standard signature here? do we need "Ctr"?
			var i = 0, l = arr && arr.length || 0, out = new (Ctr || Array)(l);
			if(l && typeof arr == "string") arr = arr.split("");
			if(typeof callback == "string") callback = cache[callback] || buildFn(callback);
			if(thisObject){
				for(; i < l; ++i){
					out[i] = callback.call(thisObject, arr[i], i, arr);
				}
			}else{
				for(; i < l; ++i){
					out[i] = callback(arr[i], i, arr);
				}
			}
			return out; // Array
		},

		filter: function(arr, callback, thisObject){
			// summary:
			//		Returns a new Array with those items from arr that match the
			//		condition implemented by callback.
			// arr: Array
			//		the array to iterate over.
			// callback: Function|String
			//		a function that is invoked with three arguments (item,
			//		index, array). The return of this function is expected to
			//		be a boolean which determines whether the passed-in item
			//		will be included in the returned array.
			// thisObject: Object?
			//		may be used to scope the call to callback
			// returns: Array
			// description:
			//		This function corresponds to the JavaScript 1.6 Array.filter() method, with one difference: when
			//		run over sparse arrays, this implementation passes the "holes" in the sparse array to
			//		the callback function with a value of undefined. JavaScript 1.6's filter skips the holes in the sparse array.
			//		For more details, see:
			//		https://developer.mozilla.org/en/Core_JavaScript_1.5_Reference/Objects/Array/filter
			// example:
			//	| // returns [2, 3, 4]
			//	| array.filter([1, 2, 3, 4], function(item){ return item>1; });

			// TODO: do we need "Ctr" here like in map()?
			var i = 0, l = arr && arr.length || 0, out = [], value;
			if(l && typeof arr == "string") arr = arr.split("");
			if(typeof callback == "string") callback = cache[callback] || buildFn(callback);
			if(thisObject){
				for(; i < l; ++i){
					value = arr[i];
					if(callback.call(thisObject, value, i, arr)){
						out.push(value);
					}
				}
			}else{
				for(; i < l; ++i){
					value = arr[i];
					if(callback(value, i, arr)){
						out.push(value);
					}
				}
			}
			return out; // Array
		},

		clearCache: function(){
			cache = {};
		}
	};


	 1  && lang.mixin(dojo, array);

	return array;
});

},
'dojo/_base/window':function(){
define(["./kernel", "./lang", "../sniff"], function(dojo, lang, has){
// module:
//		dojo/_base/window

var ret = {
	// summary:
	//		API to save/set/restore the global/document scope.

	global: dojo.global,
	/*=====
	 global: {
		 // summary:
		 //		Alias for the current window. 'global' can be modified
		 //		for temporary context shifting. See also withGlobal().
		 // description:
		 //		Use this rather than referring to 'window' to ensure your code runs
		 //		correctly in managed contexts.
	 },
	 =====*/

	doc: this["document"] || null,
	/*=====
	doc: {
		// summary:
		//		Alias for the current document. 'doc' can be modified
		//		for temporary context shifting. See also withDoc().
		// description:
		//		Use this rather than referring to 'window.document' to ensure your code runs
		//		correctly in managed contexts.
		// example:
		//	|	n.appendChild(dojo.doc.createElement('div'));
	},
	=====*/

	body: function(/*Document?*/ doc){
		// summary:
		//		Return the body element of the specified document or of dojo/_base/window::doc.
		// example:
		//	|	win.body().appendChild(dojo.doc.createElement('div'));

		// Note: document.body is not defined for a strict xhtml document
		// Would like to memoize this, but dojo.doc can change vi dojo.withDoc().
		doc = doc || dojo.doc;
		return doc.body || doc.getElementsByTagName("body")[0]; // Node
	},

	setContext: function(/*Object*/ globalObject, /*DocumentElement*/ globalDocument){
		// summary:
		//		changes the behavior of many core Dojo functions that deal with
		//		namespace and DOM lookup, changing them to work in a new global
		//		context (e.g., an iframe). The varibles dojo.global and dojo.doc
		//		are modified as a result of calling this function and the result of
		//		`dojo.body()` likewise differs.
		dojo.global = ret.global = globalObject;
		dojo.doc = ret.doc = globalDocument;
	},

	withGlobal: function(	/*Object*/ globalObject,
							/*Function*/ callback,
							/*Object?*/ thisObject,
							/*Array?*/ cbArguments){
		// summary:
		//		Invoke callback with globalObject as dojo.global and
		//		globalObject.document as dojo.doc.
		// description:
		//		Invoke callback with globalObject as dojo.global and
		//		globalObject.document as dojo.doc. If provided, globalObject
		//		will be executed in the context of object thisObject
		//		When callback() returns or throws an error, the dojo.global
		//		and dojo.doc will be restored to its previous state.

		var oldGlob = dojo.global;
		try{
			dojo.global = ret.global = globalObject;
			return ret.withDoc.call(null, globalObject.document, callback, thisObject, cbArguments);
		}finally{
			dojo.global = ret.global = oldGlob;
		}
	},

	withDoc: function(	/*DocumentElement*/ documentObject,
						/*Function*/ callback,
						/*Object?*/ thisObject,
						/*Array?*/ cbArguments){
		// summary:
		//		Invoke callback with documentObject as dojo/_base/window::doc.
		// description:
		//		Invoke callback with documentObject as dojo/_base/window::doc. If provided,
		//		callback will be executed in the context of object thisObject
		//		When callback() returns or throws an error, the dojo/_base/window::doc will
		//		be restored to its previous state.

		var oldDoc = ret.doc,
			oldQ =  0 ,
			oldIE = has("ie"), isIE, mode, pwin;

		try{
			dojo.doc = ret.doc = documentObject;
			// update dojo.isQuirks and the value of the has feature "quirks".
			// remove setting dojo.isQuirks and dojo.isIE for 2.0
			dojo.isQuirks =  0 && has.add("quirks", dojo.doc.compatMode == "BackCompat", true, true); // no need to check for QuirksMode which was Opera 7 only

			if(has("ie")){
				if((pwin = documentObject.parentWindow) && pwin.navigator){
					// re-run IE detection logic and update dojo.isIE / has("ie")
					// (the only time parentWindow/navigator wouldn't exist is if we were not
					// passed an actual legitimate document object)
					isIE = parseFloat(pwin.navigator.appVersion.split("MSIE ")[1]) || undefined;
					mode = documentObject.documentMode;
					if(mode && mode != 5 && Math.floor(isIE) != mode){
						isIE = mode;
					}
					dojo.isIE = has.add("ie", isIE, true, true);
				}
			}

			if(thisObject && typeof callback == "string"){
				callback = thisObject[callback];
			}

			return callback.apply(thisObject, cbArguments || []);
		}finally{
			dojo.doc = ret.doc = oldDoc;
			dojo.isQuirks =  0 && has.add("quirks", oldQ, true, true);
			dojo.isIE = has.add("ie", oldIE, true, true);
		}
	}
};

 1  && lang.mixin(dojo, ret);

return ret;

});

},
'dojox/mobile/Heading':function(){
define([
	"dojo/_base/array",
	"dojo/_base/connect",
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/window",
	"dojo/dom",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/dom-style",
	"dijit/registry",
	"dijit/_Contained",
	"dijit/_Container",
	"dijit/_WidgetBase",
	"./ProgressIndicator",
	"./ToolBarButton",
	"./View"
], function(array, connect, declare, lang, win, dom, domClass, domConstruct, domStyle, registry, Contained, Container, WidgetBase, ProgressIndicator, ToolBarButton, View){

	// module:
	//		dojox/mobile/Heading

	var dm = lang.getObject("dojox.mobile", true);

	return declare("dojox.mobile.Heading", [WidgetBase, Container, Contained],{
		// summary:
		//		A widget that represents a navigation bar.
		// description:
		//		Heading is a widget that represents a navigation bar, which
		//		usually appears at the top of an application. It usually
		//		displays the title of the current view and can contain a
		//		navigational control. If you use it with
		//		dojox/mobile/ScrollableView, it can also be used as a fixed
		//		header bar or a fixed footer bar. In such cases, specify the
		//		fixed="top" attribute to be a fixed header bar or the
		//		fixed="bottom" attribute to be a fixed footer bar. Heading can
		//		have one or more ToolBarButton widgets as its children.

		// back: String
		//		A label for the navigational control to return to the previous View.
		back: "",

		// href: String
		//		A URL to open when the navigational control is pressed.
		href: "",

		// moveTo: String
		//		The id of the transition destination of the navigation control.
		//		If the value has a hash sign ('#') before the id (e.g. #view1)
		//		and the dojox/mobile/bookmarkable module is loaded by the user application,
		//		the view transition updates the hash in the browser URL so that the
		//		user can bookmark the destination view. In this case, the user
		//		can also use the browser's back/forward button to navigate
		//		through the views in the browser history.
		//
		//		If null, transitions to a blank view.
		//		If '#', returns immediately without transition.
		moveTo: "",

		// transition: String
		//		A type of animated transition effect. You can choose from the
		//		standard transition types, "slide", "fade", "flip", or from the
		//		extended transition types, "cover", "coverv", "dissolve",
		//		"reveal", "revealv", "scaleIn", "scaleOut", "slidev",
		//		"swirl", "zoomIn", "zoomOut", "cube", and "swap". If "none" is
		//		specified, transition occurs immediately without animation.
		transition: "slide",

		// label: String
		//		A title text of the heading. If the label is not specified, the
		//		innerHTML of the node is used as a label.
		label: "",

		// iconBase: String
		//		The default icon path for child items.
		iconBase: "",

		// tag: String
		//		A name of HTML tag to create as domNode.
		tag: "h1",

		// busy: Boolean
		//		If true, a progress indicator spins on this widget.
		busy: false,

		// progStyle: String
		//		A css class name to add to the progress indicator.
		progStyle: "mblProgWhite",

		/* internal properties */
		
		// baseClass: String
		//		The name of the CSS class of this widget.	
		baseClass: "mblHeading",

		buildRendering: function(){
			this.domNode = this.containerNode = this.srcNodeRef || win.doc.createElement(this.tag);
			this.inherited(arguments);
			if(!this.label){
				array.forEach(this.domNode.childNodes, function(n){
					if(n.nodeType == 3){
						var v = lang.trim(n.nodeValue);
						if(v){
							this.label = v;
							this.labelNode = domConstruct.create("span", {innerHTML:v}, n, "replace");
						}
					}
				}, this);
			}
			if(!this.labelNode){
				this.labelNode = domConstruct.create("span", null, this.domNode);
			}
			this.labelNode.className = "mblHeadingSpanTitle";
			this.labelDivNode = domConstruct.create("div", {
				className: "mblHeadingDivTitle",
				innerHTML: this.labelNode.innerHTML
			}, this.domNode);

			dom.setSelectable(this.domNode, false);
		},

		startup: function(){
			if(this._started){ return; }
			var parent = this.getParent && this.getParent();
			if(!parent || !parent.resize){ // top level widget
				var _this = this;
				setTimeout(function(){ // necessary to render correctly
					_this.resize();
				}, 0);
			}
			this.inherited(arguments);
		},

		resize: function(){
			if(this.labelNode){
				// find the rightmost left button (B), and leftmost right button (C)
				// +-----------------------------+
				// | |A| |B|             |C| |D| |
				// +-----------------------------+
				var leftBtn, rightBtn;
				var children = this.containerNode.childNodes;
				for(var i = children.length - 1; i >= 0; i--){
					var c = children[i];
					if(c.nodeType === 1 && domStyle.get(c, "display") !== "none"){
						if(!rightBtn && domStyle.get(c, "float") === "right"){
							rightBtn = c;
						}
						if(!leftBtn && domStyle.get(c, "float") === "left"){
							leftBtn = c;
						}
					}
				}

				if(!this.labelNodeLen && this.label){
					this.labelNode.style.display = "inline";
					this.labelNodeLen = this.labelNode.offsetWidth;
					this.labelNode.style.display = "";
				}

				var bw = this.domNode.offsetWidth; // bar width
				var rw = rightBtn ? bw - rightBtn.offsetLeft + 5 : 0; // rightBtn width
				var lw = leftBtn ? leftBtn.offsetLeft + leftBtn.offsetWidth + 5 : 0; // leftBtn width
				var tw = this.labelNodeLen || 0; // title width
				domClass[bw - Math.max(rw,lw)*2 > tw ? "add" : "remove"](this.domNode, "mblHeadingCenterTitle");
			}
			array.forEach(this.getChildren(), function(child){
				if(child.resize){ child.resize(); }
			});
		},

		_setBackAttr: function(/*String*/back){
			// tags:
			//		private
			this._set("back", back);
			if(!this.backButton){
				this.backButton = new ToolBarButton({
					arrow: "left",
					label: back,
					moveTo: this.moveTo,
					back: !this.moveTo,
					href: this.href,
					transition: this.transition,
					transitionDir: -1
				});
				this.backButton.placeAt(this.domNode, "first");
			}else{
				this.backButton.set("label", back);
			}
			this.resize();
		},
		
		_setMoveToAttr: function(/*String*/moveTo){
			// tags:
			//		private
			this._set("moveTo", moveTo);
			if(this.backButton){
				this.backButton.set("moveTo", moveTo);
			}
		},

		_setLabelAttr: function(/*String*/label){
			// tags:
			//		private
			this._set("label", label);
			this.labelNode.innerHTML = this.labelDivNode.innerHTML = this._cv ? this._cv(label) : label;
		},

		_setBusyAttr: function(/*Boolean*/busy){
			// tags:
			//		private
			var prog = this._prog;
			if(busy){
				if(!prog){
					prog = this._prog = new ProgressIndicator({size:30, center:false});
					domClass.add(prog.domNode, this.progStyle);
				}
				domConstruct.place(prog.domNode, this.domNode, "first");
				prog.start();
			}else{
				prog.stop();
			}
			this._set("busy", busy);
		}	
	});
});

},
'dojo/_base/connect':function(){
define(["./kernel", "../on", "../topic", "../aspect", "./event", "../mouse", "./sniff", "./lang", "../keys"], function(dojo, on, hub, aspect, eventModule, mouse, has, lang){
// module:
//		dojo/_base/connect

has.add("events-keypress-typed", function(){ // keypresses should only occur a printable character is hit
	var testKeyEvent = {charCode: 0};
	try{
		testKeyEvent = document.createEvent("KeyboardEvent");
		(testKeyEvent.initKeyboardEvent || testKeyEvent.initKeyEvent).call(testKeyEvent, "keypress", true, true, null, false, false, false, false, 9, 3);
	}catch(e){}
	return testKeyEvent.charCode == 0 && ! 0 ;
});

function connect_(obj, event, context, method, dontFix){
	method = lang.hitch(context, method);
	if(!obj || !(obj.addEventListener || obj.attachEvent)){
		// it is a not a DOM node and we are using the dojo.connect style of treating a
		// method like an event, must go right to aspect
		return aspect.after(obj || dojo.global, event, method, true);
	}
	if(typeof event == "string" && event.substring(0, 2) == "on"){
		event = event.substring(2);
	}
	if(!obj){
		obj = dojo.global;
	}
	if(!dontFix){
		switch(event){
			// dojo.connect has special handling for these event types
			case "keypress":
				event = keypress;
				break;
			case "mouseenter":
				event = mouse.enter;
				break;
			case "mouseleave":
				event = mouse.leave;
				break;
		}
	}
	return on(obj, event, method, dontFix);
}

var _punctMap = {
	106:42,
	111:47,
	186:59,
	187:43,
	188:44,
	189:45,
	190:46,
	191:47,
	192:96,
	219:91,
	220:92,
	221:93,
	222:39,
	229:113
};
var evtCopyKey = has("mac") ? "metaKey" : "ctrlKey";


var _synthesizeEvent = function(evt, props){
	var faux = lang.mixin({}, evt, props);
	setKeyChar(faux);
	// FIXME: would prefer to use lang.hitch: lang.hitch(evt, evt.preventDefault);
	// but it throws an error when preventDefault is invoked on Safari
	// does Event.preventDefault not support "apply" on Safari?
	faux.preventDefault = function(){ evt.preventDefault(); };
	faux.stopPropagation = function(){ evt.stopPropagation(); };
	return faux;
};
function setKeyChar(evt){
	evt.keyChar = evt.charCode ? String.fromCharCode(evt.charCode) : '';
	evt.charOrCode = evt.keyChar || evt.keyCode;
}
var keypress;
if(has("events-keypress-typed")){
	// this emulates Firefox's keypress behavior where every keydown can correspond to a keypress
	var _trySetKeyCode = function(e, code){
		try{
			// squelch errors when keyCode is read-only
			// (e.g. if keyCode is ctrl or shift)
			return (e.keyCode = code);
		}catch(e){
			return 0;
		}
	};
	keypress = function(object, listener){
		var keydownSignal = on(object, "keydown", function(evt){
			// munge key/charCode
			var k=evt.keyCode;
			// These are Windows Virtual Key Codes
			// http://msdn.microsoft.com/library/default.asp?url=/library/en-us/winui/WinUI/WindowsUserInterface/UserInput/VirtualKeyCodes.asp
			var unprintable = (k!=13) && k!=32 && (k!=27||!has("ie")) && (k<48||k>90) && (k<96||k>111) && (k<186||k>192) && (k<219||k>222) && k!=229;
			// synthesize keypress for most unprintables and CTRL-keys
			if(unprintable||evt.ctrlKey){
				var c = unprintable ? 0 : k;
				if(evt.ctrlKey){
					if(k==3 || k==13){
						return listener.call(evt.currentTarget, evt); // IE will post CTRL-BREAK, CTRL-ENTER as keypress natively
					}else if(c>95 && c<106){
						c -= 48; // map CTRL-[numpad 0-9] to ASCII
					}else if((!evt.shiftKey)&&(c>=65&&c<=90)){
						c += 32; // map CTRL-[A-Z] to lowercase
					}else{
						c = _punctMap[c] || c; // map other problematic CTRL combinations to ASCII
					}
				}
				// simulate a keypress event
				var faux = _synthesizeEvent(evt, {type: 'keypress', faux: true, charCode: c});
				listener.call(evt.currentTarget, faux);
				if(has("ie")){
					_trySetKeyCode(evt, faux.keyCode);
				}
			}
		});
		var keypressSignal = on(object, "keypress", function(evt){
			var c = evt.charCode;
			c = c>=32 ? c : 0;
			evt = _synthesizeEvent(evt, {charCode: c, faux: true});
			return listener.call(this, evt);
		});
		return {
			remove: function(){
				keydownSignal.remove();
				keypressSignal.remove();
			}
		};
	};
}else{
	if( 0 ){
		keypress = function(object, listener){
			return on(object, "keypress", function(evt){
				var c = evt.which;
				if(c==3){
					c=99; // Mozilla maps CTRL-BREAK to CTRL-c
				}
				// can't trap some keys at all, like INSERT and DELETE
				// there is no differentiating info between DELETE and ".", or INSERT and "-"
				c = c<32 && !evt.shiftKey ? 0 : c;
				if(evt.ctrlKey && !evt.shiftKey && c>=65 && c<=90){
					// lowercase CTRL-[A-Z] keys
					c += 32;
				}
				return listener.call(this, _synthesizeEvent(evt, { charCode: c }));
			});
		};
	}else{
		keypress = function(object, listener){
			return on(object, "keypress", function(evt){
				setKeyChar(evt);
				return listener.call(this, evt);
			});
		};
	}
}

var connect = {
	// summary:
	//		This module defines the dojo.connect API.
	//		This modules also provides keyboard event handling helpers.
	//		This module exports an extension event for emulating Firefox's keypress handling.
	//		However, this extension event exists primarily for backwards compatibility and
	//		is not recommended. WebKit and IE uses an alternate keypress handling (only
	//		firing for printable characters, to distinguish from keydown events), and most
	//		consider the WebKit/IE behavior more desirable.

	_keypress:keypress,

	connect:function(obj, event, context, method, dontFix){
		// summary:
		//		`dojo.connect` is a deprecated event handling and delegation method in
		//		Dojo. It allows one function to "listen in" on the execution of
		//		any other, triggering the second whenever the first is called. Many
		//		listeners may be attached to a function, and source functions may
		//		be either regular function calls or DOM events.
		//
		// description:
		//		Connects listeners to actions, so that after event fires, a
		//		listener is called with the same arguments passed to the original
		//		function.
		//
		//		Since `dojo.connect` allows the source of events to be either a
		//		"regular" JavaScript function or a DOM event, it provides a uniform
		//		interface for listening to all the types of events that an
		//		application is likely to deal with though a single, unified
		//		interface. DOM programmers may want to think of it as
		//		"addEventListener for everything and anything".
		//
		//		When setting up a connection, the `event` parameter must be a
		//		string that is the name of the method/event to be listened for. If
		//		`obj` is null, `kernel.global` is assumed, meaning that connections
		//		to global methods are supported but also that you may inadvertently
		//		connect to a global by passing an incorrect object name or invalid
		//		reference.
		//
		//		`dojo.connect` generally is forgiving. If you pass the name of a
		//		function or method that does not yet exist on `obj`, connect will
		//		not fail, but will instead set up a stub method. Similarly, null
		//		arguments may simply be omitted such that fewer than 4 arguments
		//		may be required to set up a connection See the examples for details.
		//
		//		The return value is a handle that is needed to
		//		remove this connection with `dojo.disconnect`.
		//
		// obj: Object?
		//		The source object for the event function.
		//		Defaults to `kernel.global` if null.
		//		If obj is a DOM node, the connection is delegated
		//		to the DOM event manager (unless dontFix is true).
		//
		// event: String
		//		String name of the event function in obj.
		//		I.e. identifies a property `obj[event]`.
		//
		// context: Object|null
		//		The object that method will receive as "this".
		//
		//		If context is null and method is a function, then method
		//		inherits the context of event.
		//
		//		If method is a string then context must be the source
		//		object object for method (context[method]). If context is null,
		//		kernel.global is used.
		//
		// method: String|Function
		//		A function reference, or name of a function in context.
		//		The function identified by method fires after event does.
		//		method receives the same arguments as the event.
		//		See context argument comments for information on method's scope.
		//
		// dontFix: Boolean?
		//		If obj is a DOM node, set dontFix to true to prevent delegation
		//		of this connection to the DOM event manager.
		//
		// example:
		//		When obj.onchange(), do ui.update():
		//	|	dojo.connect(obj, "onchange", ui, "update");
		//	|	dojo.connect(obj, "onchange", ui, ui.update); // same
		//
		// example:
		//		Using return value for disconnect:
		//	|	var link = dojo.connect(obj, "onchange", ui, "update");
		//	|	...
		//	|	dojo.disconnect(link);
		//
		// example:
		//		When onglobalevent executes, watcher.handler is invoked:
		//	|	dojo.connect(null, "onglobalevent", watcher, "handler");
		//
		// example:
		//		When ob.onCustomEvent executes, customEventHandler is invoked:
		//	|	dojo.connect(ob, "onCustomEvent", null, "customEventHandler");
		//	|	dojo.connect(ob, "onCustomEvent", "customEventHandler"); // same
		//
		// example:
		//		When ob.onCustomEvent executes, customEventHandler is invoked
		//		with the same scope (this):
		//	|	dojo.connect(ob, "onCustomEvent", null, customEventHandler);
		//	|	dojo.connect(ob, "onCustomEvent", customEventHandler); // same
		//
		// example:
		//		When globalEvent executes, globalHandler is invoked
		//		with the same scope (this):
		//	|	dojo.connect(null, "globalEvent", null, globalHandler);
		//	|	dojo.connect("globalEvent", globalHandler); // same

		// normalize arguments
		var a=arguments, args=[], i=0;
		// if a[0] is a String, obj was omitted
		args.push(typeof a[0] == "string" ? null : a[i++], a[i++]);
		// if the arg-after-next is a String or Function, context was NOT omitted
		var a1 = a[i+1];
		args.push(typeof a1 == "string" || typeof a1 == "function" ? a[i++] : null, a[i++]);
		// absorb any additional arguments
		for(var l=a.length; i<l; i++){	args.push(a[i]); }
		return connect_.apply(this, args);
	},

	disconnect:function(handle){
		// summary:
		//		Remove a link created by dojo.connect.
		// description:
		//		Removes the connection between event and the method referenced by handle.
		// handle: Handle
		//		the return value of the dojo.connect call that created the connection.

		if(handle){
			handle.remove();
		}
	},

	subscribe:function(topic, context, method){
		// summary:
		//		Attach a listener to a named topic. The listener function is invoked whenever the
		//		named topic is published (see: dojo.publish).
		//		Returns a handle which is needed to unsubscribe this listener.
		// topic: String
		//		The topic to which to subscribe.
		// context: Object?
		//		Scope in which method will be invoked, or null for default scope.
		// method: String|Function
		//		The name of a function in context, or a function reference. This is the function that
		//		is invoked when topic is published.
		// example:
		//	|	dojo.subscribe("alerts", null, function(caption, message){ alert(caption + "\n" + message); });
		//	|	dojo.publish("alerts", [ "read this", "hello world" ]);
		return hub.subscribe(topic, lang.hitch(context, method));
	},

	publish:function(topic, args){
		// summary:
		//		Invoke all listener method subscribed to topic.
		// topic: String
		//		The name of the topic to publish.
		// args: Array?
		//		An array of arguments. The arguments will be applied
		//		to each topic subscriber (as first class parameters, via apply).
		// example:
		//	|	dojo.subscribe("alerts", null, function(caption, message){ alert(caption + "\n" + message); };
		//	|	dojo.publish("alerts", [ "read this", "hello world" ]);
		return hub.publish.apply(hub, [topic].concat(args));
	},

	connectPublisher:function(topic, obj, event){
		// summary:
		//		Ensure that every time obj.event() is called, a message is published
		//		on the topic. Returns a handle which can be passed to
		//		dojo.disconnect() to disable subsequent automatic publication on
		//		the topic.
		// topic: String
		//		The name of the topic to publish.
		// obj: Object?
		//		The source object for the event function. Defaults to kernel.global
		//		if null.
		// event: String
		//		The name of the event function in obj.
		//		I.e. identifies a property obj[event].
		// example:
		//	|	dojo.connectPublisher("/ajax/start", dojo, "xhrGet");
		var pf = function(){ connect.publish(topic, arguments); };
		return event ? connect.connect(obj, event, pf) : connect.connect(obj, pf); //Handle
	},

	isCopyKey: function(e){
		// summary:
		//		Checks an event for the copy key (meta on Mac, and ctrl anywhere else)
		// e: Event
		//		Event object to examine
		return e[evtCopyKey];	// Boolean
	}
};

connect.unsubscribe = connect.disconnect;
/*=====
 connect.unsubscribe = function(handle){
	 // summary:
	 //		Remove a topic listener.
	 // handle: Handle
	 //		The handle returned from a call to subscribe.
	 // example:
	 //	|	var alerter = dojo.subscribe("alerts", null, function(caption, message){ alert(caption + "\n" + message); };
	 //	|	...
	 //	|	dojo.unsubscribe(alerter);
 };
 =====*/

 1  && lang.mixin(dojo, connect);
return connect;

});



},
'dojo/on':function(){
define(["./has!dom-addeventlistener?:./aspect", "./_base/kernel", "./has"], function(aspect, dojo, has){

	"use strict";
	if( 1 ){ // check to make sure we are in a browser, this module should work anywhere
		var major = window.ScriptEngineMajorVersion;
		has.add("jscript", major && (major() + ScriptEngineMinorVersion() / 10));
		has.add("event-orientationchange", has("touch") && !has("android")); // TODO: how do we detect this?
		has.add("event-stopimmediatepropagation", window.Event && !!window.Event.prototype && !!window.Event.prototype.stopImmediatePropagation);
	}
	var on = function(target, type, listener, dontFix){
		// summary:
		//		A function that provides core event listening functionality. With this function
		//		you can provide a target, event type, and listener to be notified of
		//		future matching events that are fired.
		// target: Element|Object
		//		This is the target object or DOM element that to receive events from
		// type: String|Function
		//		This is the name of the event to listen for or an extension event type.
		// listener: Function
		//		This is the function that should be called when the event fires.
		// returns: Object
		//		An object with a remove() method that can be used to stop listening for this
		//		event.
		// description:
		//		To listen for "click" events on a button node, we can do:
		//		|	define(["dojo/on"], function(listen){
		//		|		on(button, "click", clickHandler);
		//		|		...
		//		Evented JavaScript objects can also have their own events.
		//		|	var obj = new Evented;
		//		|	on(obj, "foo", fooHandler);
		//		And then we could publish a "foo" event:
		//		|	on.emit(obj, "foo", {key: "value"});
		//		We can use extension events as well. For example, you could listen for a tap gesture:
		//		|	define(["dojo/on", "dojo/gesture/tap", function(listen, tap){
		//		|		on(button, tap, tapHandler);
		//		|		...
		//		which would trigger fooHandler. Note that for a simple object this is equivalent to calling:
		//		|	obj.onfoo({key:"value"});
		//		If you use on.emit on a DOM node, it will use native event dispatching when possible.

		if(typeof target.on == "function" && typeof type != "function"){
			// delegate to the target's on() method, so it can handle it's own listening if it wants
			return target.on(type, listener);
		}
		// delegate to main listener code
		return on.parse(target, type, listener, addListener, dontFix, this);
	};
	on.pausable =  function(target, type, listener, dontFix){
		// summary:
		//		This function acts the same as on(), but with pausable functionality. The
		//		returned signal object has pause() and resume() functions. Calling the
		//		pause() method will cause the listener to not be called for future events. Calling the
		//		resume() method will cause the listener to again be called for future events.
		var paused;
		var signal = on(target, type, function(){
			if(!paused){
				return listener.apply(this, arguments);
			}
		}, dontFix);
		signal.pause = function(){
			paused = true;
		};
		signal.resume = function(){
			paused = false;
		};
		return signal;
	};
	on.once = function(target, type, listener, dontFix){
		// summary:
		//		This function acts the same as on(), but will only call the listener once. The 
		//		listener will be called for the first
		//		event that takes place and then listener will automatically be removed.
		var signal = on(target, type, function(){
			// remove this listener
			signal.remove();
			// proceed to call the listener
			return listener.apply(this, arguments);
		});
		return signal;
	};
	on.parse = function(target, type, listener, addListener, dontFix, matchesTarget){
		if(type.call){
			// event handler function
			// on(node, touch.press, touchListener);
			return type.call(matchesTarget, target, listener);
		}

		if(type.indexOf(",") > -1){
			// we allow comma delimited event names, so you can register for multiple events at once
			var events = type.split(/\s*,\s*/);
			var handles = [];
			var i = 0;
			var eventName;
			while(eventName = events[i++]){
				handles.push(addListener(target, eventName, listener, dontFix, matchesTarget));
			}
			handles.remove = function(){
				for(var i = 0; i < handles.length; i++){
					handles[i].remove();
				}
			};
			return handles;
		}
		return addListener(target, type, listener, dontFix, matchesTarget);
	};
	var touchEvents = /^touch/;
	function addListener(target, type, listener, dontFix, matchesTarget){
		// event delegation:
		var selector = type.match(/(.*):(.*)/);
		// if we have a selector:event, the last one is interpreted as an event, and we use event delegation
		if(selector){
			type = selector[2];
			selector = selector[1];
			// create the extension event for selectors and directly call it
			return on.selector(selector, type).call(matchesTarget, target, listener);
		}
		// test to see if it a touch event right now, so we don't have to do it every time it fires
		if(has("touch")){
			if(touchEvents.test(type)){
				// touch event, fix it
				listener = fixTouchListener(listener);
			}
			if(!has("event-orientationchange") && (type == "orientationchange")){
				//"orientationchange" not supported <= Android 2.1, 
				//but works through "resize" on window
				type = "resize"; 
				target = window;
				listener = fixTouchListener(listener);
			} 
		}
		if(addStopImmediate){
			// add stopImmediatePropagation if it doesn't exist
			listener = addStopImmediate(listener);
		}
		// normal path, the target is |this|
		if(target.addEventListener){
			// the target has addEventListener, which should be used if available (might or might not be a node, non-nodes can implement this method as well)
			// check for capture conversions
			var capture = type in captures,
				adjustedType = capture ? captures[type] : type;
			target.addEventListener(adjustedType, listener, capture);
			// create and return the signal
			return {
				remove: function(){
					target.removeEventListener(adjustedType, listener, capture);
				}
			};
		}
		type = "on" + type;
		if(fixAttach && target.attachEvent){
			return fixAttach(target, type, listener);
		}
		throw new Error("Target must be an event emitter");
	}

	on.selector = function(selector, eventType, children){
		// summary:
		//		Creates a new extension event with event delegation. This is based on
		//		the provided event type (can be extension event) that
		//		only calls the listener when the CSS selector matches the target of the event.
		//
		//		The application must require() an appropriate level of dojo/query to handle the selector.
		// selector:
		//		The CSS selector to use for filter events and determine the |this| of the event listener.
		// eventType:
		//		The event to listen for
		// children:
		//		Indicates if children elements of the selector should be allowed. This defaults to 
		//		true
		// example:
		// |	require(["dojo/on", "dojo/mouse", "dojo/query!css2"], function(listen, mouse){
		// |		on(node, on.selector(".my-class", mouse.enter), handlerForMyHover);
		return function(target, listener){
			// if the selector is function, use it to select the node, otherwise use the matches method
			var matchesTarget = typeof selector == "function" ? {matches: selector} : this,
				bubble = eventType.bubble;
			function select(eventTarget){
				// see if we have a valid matchesTarget or default to dojo.query
				matchesTarget = matchesTarget && matchesTarget.matches ? matchesTarget : dojo.query;
				// there is a selector, so make sure it matches
				while(!matchesTarget.matches(eventTarget, selector, target)){
					if(eventTarget == target || children === false || !(eventTarget = eventTarget.parentNode) || eventTarget.nodeType != 1){ // intentional assignment
						return;
					}
				}
				return eventTarget;
			}
			if(bubble){
				// the event type doesn't naturally bubble, but has a bubbling form, use that, and give it the selector so it can perform the select itself
				return on(target, bubble(select), listener);
			}
			// standard event delegation
			return on(target, eventType, function(event){
				// call select to see if we match
				var eventTarget = select(event.target);
				// if it matches we call the listener
				return eventTarget && listener.call(eventTarget, event);
			});
		};
	};

	function syntheticPreventDefault(){
		this.cancelable = false;
	}
	function syntheticStopPropagation(){
		this.bubbles = false;
	}
	var slice = [].slice,
		syntheticDispatch = on.emit = function(target, type, event){
		// summary:
		//		Fires an event on the target object.
		// target:
		//		The target object to fire the event on. This can be a DOM element or a plain 
		//		JS object. If the target is a DOM element, native event emiting mechanisms
		//		are used when possible.
		// type:
		//		The event type name. You can emulate standard native events like "click" and 
		//		"mouseover" or create custom events like "open" or "finish".
		// event:
		//		An object that provides the properties for the event. See https://developer.mozilla.org/en/DOM/event.initEvent 
		//		for some of the properties. These properties are copied to the event object.
		//		Of particular importance are the cancelable and bubbles properties. The
		//		cancelable property indicates whether or not the event has a default action
		//		that can be cancelled. The event is cancelled by calling preventDefault() on
		//		the event object. The bubbles property indicates whether or not the
		//		event will bubble up the DOM tree. If bubbles is true, the event will be called
		//		on the target and then each parent successively until the top of the tree
		//		is reached or stopPropagation() is called. Both bubbles and cancelable 
		//		default to false.
		// returns:
		//		If the event is cancelable and the event is not cancelled,
		//		emit will return true. If the event is cancelable and the event is cancelled,
		//		emit will return false.
		// details:
		//		Note that this is designed to emit events for listeners registered through
		//		dojo/on. It should actually work with any event listener except those
		//		added through IE's attachEvent (IE8 and below's non-W3C event emiting
		//		doesn't support custom event types). It should work with all events registered
		//		through dojo/on. Also note that the emit method does do any default
		//		action, it only returns a value to indicate if the default action should take
		//		place. For example, emiting a keypress event would not cause a character
		//		to appear in a textbox.
		// example:
		//		To fire our own click event
		//	|	on.emit(dojo.byId("button"), "click", {
		//	|		cancelable: true,
		//	|		bubbles: true,
		//	|		screenX: 33,
		//	|		screenY: 44
		//	|	});
		//		We can also fire our own custom events:
		//	|	on.emit(dojo.byId("slider"), "slide", {
		//	|		cancelable: true,
		//	|		bubbles: true,
		//	|		direction: "left-to-right"
		//	|	});
		var args = slice.call(arguments, 2);
		var method = "on" + type;
		if("parentNode" in target){
			// node (or node-like), create event controller methods
			var newEvent = args[0] = {};
			for(var i in event){
				newEvent[i] = event[i];
			}
			newEvent.preventDefault = syntheticPreventDefault;
			newEvent.stopPropagation = syntheticStopPropagation;
			newEvent.target = target;
			newEvent.type = type;
			event = newEvent;
		}
		do{
			// call any node which has a handler (note that ideally we would try/catch to simulate normal event propagation but that causes too much pain for debugging)
			target[method] && target[method].apply(target, args);
			// and then continue up the parent node chain if it is still bubbling (if started as bubbles and stopPropagation hasn't been called)
		}while(event && event.bubbles && (target = target.parentNode));
		return event && event.cancelable && event; // if it is still true (was cancelable and was cancelled), return the event to indicate default action should happen
	};
	var captures = {};
	if(!has("event-stopimmediatepropagation")){
		var stopImmediatePropagation =function(){
			this.immediatelyStopped = true;
			this.modified = true; // mark it as modified so the event will be cached in IE
		};
		var addStopImmediate = function(listener){
			return function(event){
				if(!event.immediatelyStopped){// check to make sure it hasn't been stopped immediately
					event.stopImmediatePropagation = stopImmediatePropagation;
					return listener.apply(this, arguments);
				}
			};
		}
	} 
	if(has("dom-addeventlistener")){
		// normalize focusin and focusout
		captures = {
			focusin: "focus",
			focusout: "blur"
		};

		// emiter that works with native event handling
		on.emit = function(target, type, event){
			if(target.dispatchEvent && document.createEvent){
				// use the native event emiting mechanism if it is available on the target object
				// create a generic event				
				// we could create branch into the different types of event constructors, but 
				// that would be a lot of extra code, with little benefit that I can see, seems 
				// best to use the generic constructor and copy properties over, making it 
				// easy to have events look like the ones created with specific initializers
				var nativeEvent = target.ownerDocument.createEvent("HTMLEvents");
				nativeEvent.initEvent(type, !!event.bubbles, !!event.cancelable);
				// and copy all our properties over
				for(var i in event){
					var value = event[i];
					if(!(i in nativeEvent)){
						nativeEvent[i] = event[i];
					}
				}
				return target.dispatchEvent(nativeEvent) && nativeEvent;
			}
			return syntheticDispatch.apply(on, arguments); // emit for a non-node
		};
	}else{
		// no addEventListener, basically old IE event normalization
		on._fixEvent = function(evt, sender){
			// summary:
			//		normalizes properties on the event object including event
			//		bubbling methods, keystroke normalization, and x/y positions
			// evt:
			//		native event object
			// sender:
			//		node to treat as "currentTarget"
			if(!evt){
				var w = sender && (sender.ownerDocument || sender.document || sender).parentWindow || window;
				evt = w.event;
			}
			if(!evt){return evt;}
			if(lastEvent && evt.type == lastEvent.type){
				// should be same event, reuse event object (so it can be augmented)
				evt = lastEvent;
			}
			if(!evt.target){ // check to see if it has been fixed yet
				evt.target = evt.srcElement;
				evt.currentTarget = (sender || evt.srcElement);
				if(evt.type == "mouseover"){
					evt.relatedTarget = evt.fromElement;
				}
				if(evt.type == "mouseout"){
					evt.relatedTarget = evt.toElement;
				}
				if(!evt.stopPropagation){
					evt.stopPropagation = stopPropagation;
					evt.preventDefault = preventDefault;
				}
				switch(evt.type){
					case "keypress":
						var c = ("charCode" in evt ? evt.charCode : evt.keyCode);
						if (c==10){
							// CTRL-ENTER is CTRL-ASCII(10) on IE, but CTRL-ENTER on Mozilla
							c=0;
							evt.keyCode = 13;
						}else if(c==13||c==27){
							c=0; // Mozilla considers ENTER and ESC non-printable
						}else if(c==3){
							c=99; // Mozilla maps CTRL-BREAK to CTRL-c
						}
						// Mozilla sets keyCode to 0 when there is a charCode
						// but that stops the event on IE.
						evt.charCode = c;
						_setKeyChar(evt);
						break;
				}
			}
			return evt;
		};
		var lastEvent, IESignal = function(handle){
			this.handle = handle;
		};
		IESignal.prototype.remove = function(){
			delete _dojoIEListeners_[this.handle];
		};
		var fixListener = function(listener){
			// this is a minimal function for closing on the previous listener with as few as variables as possible
			return function(evt){
				evt = on._fixEvent(evt, this);
				var result = listener.call(this, evt);
				if(evt.modified){
					// cache the last event and reuse it if we can
					if(!lastEvent){
						setTimeout(function(){
							lastEvent = null;
						});
					}
					lastEvent = evt;
				}
				return result;
			};
		};
		var fixAttach = function(target, type, listener){
			listener = fixListener(listener);
			if(((target.ownerDocument ? target.ownerDocument.parentWindow : target.parentWindow || target.window || window) != top || 
						has("jscript") < 5.8) && 
					!has("config-_allow_leaks")){
				// IE will leak memory on certain handlers in frames (IE8 and earlier) and in unattached DOM nodes for JScript 5.7 and below.
				// Here we use global redirection to solve the memory leaks
				if(typeof _dojoIEListeners_ == "undefined"){
					_dojoIEListeners_ = [];
				}
				var emiter = target[type];
				if(!emiter || !emiter.listeners){
					var oldListener = emiter;
					emiter = Function('event', 'var callee = arguments.callee; for(var i = 0; i<callee.listeners.length; i++){var listener = _dojoIEListeners_[callee.listeners[i]]; if(listener){listener.call(this,event);}}');
					emiter.listeners = [];
					target[type] = emiter;
					emiter.global = this;
					if(oldListener){
						emiter.listeners.push(_dojoIEListeners_.push(oldListener) - 1);
					}
				}
				var handle;
				emiter.listeners.push(handle = (emiter.global._dojoIEListeners_.push(listener) - 1));
				return new IESignal(handle);
			}
			return aspect.after(target, type, listener, true);
		};

		var _setKeyChar = function(evt){
			evt.keyChar = evt.charCode ? String.fromCharCode(evt.charCode) : '';
			evt.charOrCode = evt.keyChar || evt.keyCode;
		};
		// Called in Event scope
		var stopPropagation = function(){
			this.cancelBubble = true;
		};
		var preventDefault = on._preventDefault = function(){
			// Setting keyCode to 0 is the only way to prevent certain keypresses (namely
			// ctrl-combinations that correspond to menu accelerator keys).
			// Otoh, it prevents upstream listeners from getting this information
			// Try to split the difference here by clobbering keyCode only for ctrl
			// combinations. If you still need to access the key upstream, bubbledKeyCode is
			// provided as a workaround.
			this.bubbledKeyCode = this.keyCode;
			if(this.ctrlKey){
				try{
					// squelch errors when keyCode is read-only
					// (e.g. if keyCode is ctrl or shift)
					this.keyCode = 0;
				}catch(e){
				}
			}
			this.defaultPrevented = true;
			this.returnValue = false;
		};
	}
	if(has("touch")){ 
		var Event = function(){};
		var windowOrientation = window.orientation; 
		var fixTouchListener = function(listener){ 
			return function(originalEvent){ 
				//Event normalization(for ontouchxxx and resize): 
				//1.incorrect e.pageX|pageY in iOS 
				//2.there are no "e.rotation", "e.scale" and "onorientationchange" in Andriod
				//3.More TBD e.g. force | screenX | screenX | clientX | clientY | radiusX | radiusY

				// see if it has already been corrected
				var event = originalEvent.corrected;
				if(!event){
					var type = originalEvent.type;
					try{
						delete originalEvent.type; // on some JS engines (android), deleting properties make them mutable
					}catch(e){} 
					if(originalEvent.type){
						// deleting properties doesn't work (older iOS), have to use delegation
						Event.prototype = originalEvent;
						var event = new Event;
						// have to delegate methods to make them work
						event.preventDefault = function(){
							originalEvent.preventDefault();
						};
						event.stopPropagation = function(){
							originalEvent.stopPropagation();
						};
					}else{
						// deletion worked, use property as is
						event = originalEvent;
						event.type = type;
					}
					originalEvent.corrected = event;
					if(type == 'resize'){
						if(windowOrientation == window.orientation){ 
							return null;//double tap causes an unexpected 'resize' in Andriod 
						} 
						windowOrientation = window.orientation;
						event.type = "orientationchange"; 
						return listener.call(this, event);
					}
					// We use the original event and augment, rather than doing an expensive mixin operation
					if(!("rotation" in event)){ // test to see if it has rotation
						event.rotation = 0; 
						event.scale = 1;
					}
					//use event.changedTouches[0].pageX|pageY|screenX|screenY|clientX|clientY|target
					var firstChangeTouch = event.changedTouches[0];
					for(var i in firstChangeTouch){ // use for-in, we don't need to have dependency on dojo/_base/lang here
						delete event[i]; // delete it first to make it mutable
						event[i] = firstChangeTouch[i];
					}
				}
				return listener.call(this, event); 
			}; 
		}; 
	}
	return on;
});

},
'dojo/topic':function(){
define(["./Evented"], function(Evented){

	// module:
	//		dojo/topic

	var hub = new Evented;
	return {
		// summary:
		//		Pubsub hub.
		// example:
		//		| 	topic.subscribe("some/topic", function(event){
		//		|	... do something with event
		//		|	});
		//		|	topic.publish("some/topic", {name:"some event", ...});

		publish: function(topic, event){
			// summary:
			//		Publishes a message to a topic on the pub/sub hub. All arguments after
			//		the first will be passed to the subscribers, so any number of arguments
			//		can be provided (not just event).
			// topic: String
			//		The name of the topic to publish to
			// event: Object
			//		An event to distribute to the topic listeners
			return hub.emit.apply(hub, arguments);
		},

		subscribe: function(topic, listener){
			// summary:
			//		Subscribes to a topic on the pub/sub hub
			// topic: String
			//		The topic to subscribe to
			// listener: Function
			//		A function to call when a message is published to the given topic
			return hub.on.apply(hub, arguments);
		}
	};
});

},
'dojo/Evented':function(){
define(["./aspect", "./on"], function(aspect, on){
	// module:
	//		dojo/Evented

 	"use strict";
 	var after = aspect.after;
	function Evented(){
		// summary:
		//		A class that can be used as a mixin or base class,
		//		to add on() and emit() methods to a class
		//		for listening for events and emitting events:
		//
		//		|	define(["dojo/Evented"], function(Evented){
		//		|		var EventedWidget = dojo.declare([Evented, dijit._Widget], {...});
		//		|		widget = new EventedWidget();
		//		|		widget.on("open", function(event){
		//		|		... do something with event
		//		|	 });
		//		|
		//		|	widget.emit("open", {name:"some event", ...});
	}
	Evented.prototype = {
		on: function(type, listener){
			return on.parse(this, type, listener, function(target, type){
				return after(target, 'on' + type, listener, true);
			});
		},
		emit: function(type, event){
			var args = [this];
			args.push.apply(args, arguments);
			return on.emit.apply(on, args);
		}
	};
	return Evented;
});

},
'dojo/aspect':function(){
define("dojo/aspect", [], function(){

	// module:
	//		dojo/aspect

	"use strict";
	var undefined, nextId = 0;
	function advise(dispatcher, type, advice, receiveArguments){
		var previous = dispatcher[type];
		var around = type == "around";
		var signal;
		if(around){
			var advised = advice(function(){
				return previous.advice(this, arguments);
			});
			signal = {
				remove: function(){
					signal.cancelled = true;
				},
				advice: function(target, args){
					return signal.cancelled ?
						previous.advice(target, args) : // cancelled, skip to next one
						advised.apply(target, args);	// called the advised function
				}
			};
		}else{
			// create the remove handler
			signal = {
				remove: function(){
					var previous = signal.previous;
					var next = signal.next;
					if(!next && !previous){
						delete dispatcher[type];
					}else{
						if(previous){
							previous.next = next;
						}else{
							dispatcher[type] = next;
						}
						if(next){
							next.previous = previous;
						}
					}
				},
				id: nextId++,
				advice: advice,
				receiveArguments: receiveArguments
			};
		}
		if(previous && !around){
			if(type == "after"){
				// add the listener to the end of the list
				// note that we had to change this loop a little bit to workaround a bizarre IE10 JIT bug 
				while(previous.next && (previous = previous.next)){}
				previous.next = signal;
				signal.previous = previous;
			}else if(type == "before"){
				// add to beginning
				dispatcher[type] = signal;
				signal.next = previous;
				previous.previous = signal;
			}
		}else{
			// around or first one just replaces
			dispatcher[type] = signal;
		}
		return signal;
	}
	function aspect(type){
		return function(target, methodName, advice, receiveArguments){
			var existing = target[methodName], dispatcher;
			if(!existing || existing.target != target){
				// no dispatcher in place
				target[methodName] = dispatcher = function(){
					var executionId = nextId;
					// before advice
					var args = arguments;
					var before = dispatcher.before;
					while(before){
						args = before.advice.apply(this, args) || args;
						before = before.next;
					}
					// around advice
					if(dispatcher.around){
						var results = dispatcher.around.advice(this, args);
					}
					// after advice
					var after = dispatcher.after;
					while(after && after.id < executionId){
						if(after.receiveArguments){
							var newResults = after.advice.apply(this, args);
							// change the return value only if a new value was returned
							results = newResults === undefined ? results : newResults;
						}else{
							results = after.advice.call(this, results, args);
						}
						after = after.next;
					}
					return results;
				};
				if(existing){
					dispatcher.around = {advice: function(target, args){
						return existing.apply(target, args);
					}};
				}
				dispatcher.target = target;
			}
			var results = advise((dispatcher || existing), type, advice, receiveArguments);
			advice = null;
			return results;
		};
	}

	// TODOC: after/before/around return object

	var after = aspect("after");
	/*=====
	after = function(target, methodName, advice, receiveArguments){
		// summary:
		//		The "after" export of the aspect module is a function that can be used to attach
		//		"after" advice to a method. This function will be executed after the original method
		//		is executed. By default the function will be called with a single argument, the return
		//		value of the original method, or the the return value of the last executed advice (if a previous one exists).
		//		The fourth (optional) argument can be set to true to so the function receives the original
		//		arguments (from when the original method was called) rather than the return value.
		//		If there are multiple "after" advisors, they are executed in the order they were registered.
		// target: Object
		//		This is the target object
		// methodName: String
		//		This is the name of the method to attach to.
		// advice: Function
		//		This is function to be called after the original method
		// receiveArguments: Boolean?
		//		If this is set to true, the advice function receives the original arguments (from when the original mehtod
		//		was called) rather than the return value of the original/previous method.
		// returns:
		//		A signal object that can be used to cancel the advice. If remove() is called on this signal object, it will
		//		stop the advice function from being executed.
	};
	=====*/

	var before = aspect("before");
	/*=====
	before = function(target, methodName, advice){
		// summary:
		//		The "before" export of the aspect module is a function that can be used to attach
		//		"before" advice to a method. This function will be executed before the original method
		//		is executed. This function will be called with the arguments used to call the method.
		//		This function may optionally return an array as the new arguments to use to call
		//		the original method (or the previous, next-to-execute before advice, if one exists).
		//		If the before method doesn't return anything (returns undefined) the original arguments
		//		will be preserved.
		//		If there are multiple "before" advisors, they are executed in the reverse order they were registered.
		// target: Object
		//		This is the target object
		// methodName: String
		//		This is the name of the method to attach to.
		// advice: Function
		//		This is function to be called before the original method
	};
	=====*/

	var around = aspect("around");
	/*=====
	 around = function(target, methodName, advice){
		// summary:
		//		The "around" export of the aspect module is a function that can be used to attach
		//		"around" advice to a method. The advisor function is immediately executed when
		//		the around() is called, is passed a single argument that is a function that can be
		//		called to continue execution of the original method (or the next around advisor).
		//		The advisor function should return a function, and this function will be called whenever
		//		the method is called. It will be called with the arguments used to call the method.
		//		Whatever this function returns will be returned as the result of the method call (unless after advise changes it).
		// example:
		//		If there are multiple "around" advisors, the most recent one is executed first,
		//		which can then delegate to the next one and so on. For example:
		//		|	around(obj, "foo", function(originalFoo){
		//		|		return function(){
		//		|			var start = new Date().getTime();
		//		|			var results = originalFoo.apply(this, arguments); // call the original
		//		|			var end = new Date().getTime();
		//		|			0 && console.log("foo execution took " + (end - start) + " ms");
		//		|			return results;
		//		|		};
		//		|	});
		// target: Object
		//		This is the target object
		// methodName: String
		//		This is the name of the method to attach to.
		// advice: Function
		//		This is function to be called around the original method
	};
	=====*/

	return {
		// summary:
		//		provides aspect oriented programming functionality, allowing for
		//		one to add before, around, or after advice on existing methods.
		// example:
		//	|	define(["dojo/aspect"], function(aspect){
		//	|		var signal = aspect.after(targetObject, "methodName", function(someArgument){
		//	|			this will be called when targetObject.methodName() is called, after the original function is called
		//	|		});
		//
		// example:
		//	The returned signal object can be used to cancel the advice.
		//	|	signal.remove(); // this will stop the advice from being executed anymore
		//	|	aspect.before(targetObject, "methodName", function(someArgument){
		//	|		// this will be called when targetObject.methodName() is called, before the original function is called
		//	|	 });

		before: before,
		around: around,
		after: after
	};
});

},
'dojo/_base/event':function(){
define(["./kernel", "../on", "../has", "../dom-geometry"], function(dojo, on, has, dom){
	// module:
	//		dojo/_base/event

	if(on._fixEvent){
		var fixEvent = on._fixEvent;
		on._fixEvent = function(evt, se){
			// add some additional normalization for back-compat, this isn't in on.js because it is somewhat more expensive
			evt = fixEvent(evt, se);
			if(evt){
				dom.normalizeEvent(evt);
			}
			return evt;
		};		
	}
	
	var ret = {
		// summary:
		//		This module defines dojo DOM event API.   Usually you should use dojo/on, and evt.stopPropagation() +
		//		evt.preventDefault(), rather than this module.

		fix: function(/*Event*/ evt, /*DOMNode*/ sender){
			// summary:
			//		normalizes properties on the event object including event
			//		bubbling methods, keystroke normalization, and x/y positions
			// evt: Event
			//		native event object
			// sender: DOMNode
			//		node to treat as "currentTarget"
			if(on._fixEvent){
				return on._fixEvent(evt, sender);
			}
			return evt;	// Event
		},
	
		stop: function(/*Event*/ evt){
			// summary:
			//		prevents propagation and clobbers the default action of the
			//		passed event
			// evt: Event
			//		The event object. If omitted, window.event is used on IE.
			if(has("dom-addeventlistener") || (evt && evt.preventDefault)){
				evt.preventDefault();
				evt.stopPropagation();
			}else{
				evt = evt || window.event;
				evt.cancelBubble = true;
				on._preventDefault.call(evt);
			}
		}
	};

	if( 1 ){
		dojo.fixEvent = ret.fix;
		dojo.stopEvent = ret.stop;
	}

	return ret;
});

},
'dojo/dom-geometry':function(){
define(["./sniff", "./_base/window","./dom", "./dom-style"],
		function(has, win, dom, style){
	// module:
	//		dojo/dom-geometry

	// the result object
	var geom = {
		// summary:
		//		This module defines the core dojo DOM geometry API.
	};

	// Box functions will assume this model.
	// On IE/Opera, BORDER_BOX will be set if the primary document is in quirks mode.
	// Can be set to change behavior of box setters.

	// can be either:
	//	"border-box"
	//	"content-box" (default)
	geom.boxModel = "content-box";

	// We punt per-node box mode testing completely.
	// If anybody cares, we can provide an additional (optional) unit
	// that overrides existing code to include per-node box sensitivity.

	// Opera documentation claims that Opera 9 uses border-box in BackCompat mode.
	// but experiments (Opera 9.10.8679 on Windows Vista) indicate that it actually continues to use content-box.
	// IIRC, earlier versions of Opera did in fact use border-box.
	// Opera guys, this is really confusing. Opera being broken in quirks mode is not our fault.

	if(has("ie") /*||  0 */){
		// client code may have to adjust if compatMode varies across iframes
		geom.boxModel = document.compatMode == "BackCompat" ? "border-box" : "content-box";
	}

	geom.getPadExtents = function getPadExtents(/*DomNode*/ node, /*Object*/ computedStyle){
		// summary:
		//		Returns object with special values specifically useful for node
		//		fitting.
		// description:
		//		Returns an object with `w`, `h`, `l`, `t` properties:
		//	|		l/t/r/b = left/top/right/bottom padding (respectively)
		//	|		w = the total of the left and right padding
		//	|		h = the total of the top and bottom padding
		//		If 'node' has position, l/t forms the origin for child nodes.
		//		The w/h are used for calculating boxes.
		//		Normally application code will not need to invoke this
		//		directly, and will use the ...box... functions instead.
		// node: DOMNode
		// computedStyle: Object?
		//		This parameter accepts computed styles object.
		//		If this parameter is omitted, the functions will call
		//		dojo.getComputedStyle to get one. It is a better way, calling
		//		dojo.computedStyle once, and then pass the reference to this
		//		computedStyle parameter. Wherever possible, reuse the returned
		//		object of dojo/dom-style.getComputedStyle().

		node = dom.byId(node);
		var s = computedStyle || style.getComputedStyle(node), px = style.toPixelValue,
			l = px(node, s.paddingLeft), t = px(node, s.paddingTop), r = px(node, s.paddingRight), b = px(node, s.paddingBottom);
		return {l: l, t: t, r: r, b: b, w: l + r, h: t + b};
	};

	var none = "none";

	geom.getBorderExtents = function getBorderExtents(/*DomNode*/ node, /*Object*/ computedStyle){
		// summary:
		//		returns an object with properties useful for noting the border
		//		dimensions.
		// description:
		//		- l/t/r/b = the sum of left/top/right/bottom border (respectively)
		//		- w = the sum of the left and right border
		//		- h = the sum of the top and bottom border
		//
		//		The w/h are used for calculating boxes.
		//		Normally application code will not need to invoke this
		//		directly, and will use the ...box... functions instead.
		// node: DOMNode
		// computedStyle: Object?
		//		This parameter accepts computed styles object.
		//		If this parameter is omitted, the functions will call
		//		dojo.getComputedStyle to get one. It is a better way, calling
		//		dojo.computedStyle once, and then pass the reference to this
		//		computedStyle parameter. Wherever possible, reuse the returned
		//		object of dojo/dom-style.getComputedStyle().

		node = dom.byId(node);
		var px = style.toPixelValue, s = computedStyle || style.getComputedStyle(node),
			l = s.borderLeftStyle != none ? px(node, s.borderLeftWidth) : 0,
			t = s.borderTopStyle != none ? px(node, s.borderTopWidth) : 0,
			r = s.borderRightStyle != none ? px(node, s.borderRightWidth) : 0,
			b = s.borderBottomStyle != none ? px(node, s.borderBottomWidth) : 0;
		return {l: l, t: t, r: r, b: b, w: l + r, h: t + b};
	};

	geom.getPadBorderExtents = function getPadBorderExtents(/*DomNode*/ node, /*Object*/ computedStyle){
		// summary:
		//		Returns object with properties useful for box fitting with
		//		regards to padding.
		// description:
		//		- l/t/r/b = the sum of left/top/right/bottom padding and left/top/right/bottom border (respectively)
		//		- w = the sum of the left and right padding and border
		//		- h = the sum of the top and bottom padding and border
		//
		//		The w/h are used for calculating boxes.
		//		Normally application code will not need to invoke this
		//		directly, and will use the ...box... functions instead.
		// node: DOMNode
		// computedStyle: Object?
		//		This parameter accepts computed styles object.
		//		If this parameter is omitted, the functions will call
		//		dojo.getComputedStyle to get one. It is a better way, calling
		//		dojo.computedStyle once, and then pass the reference to this
		//		computedStyle parameter. Wherever possible, reuse the returned
		//		object of dojo/dom-style.getComputedStyle().

		node = dom.byId(node);
		var s = computedStyle || style.getComputedStyle(node),
			p = geom.getPadExtents(node, s),
			b = geom.getBorderExtents(node, s);
		return {
			l: p.l + b.l,
			t: p.t + b.t,
			r: p.r + b.r,
			b: p.b + b.b,
			w: p.w + b.w,
			h: p.h + b.h
		};
	};

	geom.getMarginExtents = function getMarginExtents(node, computedStyle){
		// summary:
		//		returns object with properties useful for box fitting with
		//		regards to box margins (i.e., the outer-box).
		//
		//		- l/t = marginLeft, marginTop, respectively
		//		- w = total width, margin inclusive
		//		- h = total height, margin inclusive
		//
		//		The w/h are used for calculating boxes.
		//		Normally application code will not need to invoke this
		//		directly, and will use the ...box... functions instead.
		// node: DOMNode
		// computedStyle: Object?
		//		This parameter accepts computed styles object.
		//		If this parameter is omitted, the functions will call
		//		dojo.getComputedStyle to get one. It is a better way, calling
		//		dojo.computedStyle once, and then pass the reference to this
		//		computedStyle parameter. Wherever possible, reuse the returned
		//		object of dojo/dom-style.getComputedStyle().

		node = dom.byId(node);
		var s = computedStyle || style.getComputedStyle(node), px = style.toPixelValue,
			l = px(node, s.marginLeft), t = px(node, s.marginTop), r = px(node, s.marginRight), b = px(node, s.marginBottom);
		return {l: l, t: t, r: r, b: b, w: l + r, h: t + b};
	};

	// Box getters work in any box context because offsetWidth/clientWidth
	// are invariant wrt box context
	//
	// They do *not* work for display: inline objects that have padding styles
	// because the user agent ignores padding (it's bogus styling in any case)
	//
	// Be careful with IMGs because they are inline or block depending on
	// browser and browser mode.

	// Although it would be easier to read, there are not separate versions of
	// _getMarginBox for each browser because:
	// 1. the branching is not expensive
	// 2. factoring the shared code wastes cycles (function call overhead)
	// 3. duplicating the shared code wastes bytes

	geom.getMarginBox = function getMarginBox(/*DomNode*/ node, /*Object*/ computedStyle){
		// summary:
		//		returns an object that encodes the width, height, left and top
		//		positions of the node's margin box.
		// node: DOMNode
		// computedStyle: Object?
		//		This parameter accepts computed styles object.
		//		If this parameter is omitted, the functions will call
		//		dojo.getComputedStyle to get one. It is a better way, calling
		//		dojo.computedStyle once, and then pass the reference to this
		//		computedStyle parameter. Wherever possible, reuse the returned
		//		object of dojo/dom-style.getComputedStyle().

		node = dom.byId(node);
		var s = computedStyle || style.getComputedStyle(node), me = geom.getMarginExtents(node, s),
			l = node.offsetLeft - me.l, t = node.offsetTop - me.t, p = node.parentNode, px = style.toPixelValue, pcs;
		if(has("mozilla")){
			// Mozilla:
			// If offsetParent has a computed overflow != visible, the offsetLeft is decreased
			// by the parent's border.
			// We don't want to compute the parent's style, so instead we examine node's
			// computed left/top which is more stable.
			var sl = parseFloat(s.left), st = parseFloat(s.top);
			if(!isNaN(sl) && !isNaN(st)){
				l = sl;
				t = st;
			}else{
				// If child's computed left/top are not parseable as a number (e.g. "auto"), we
				// have no choice but to examine the parent's computed style.
				if(p && p.style){
					pcs = style.getComputedStyle(p);
					if(pcs.overflow != "visible"){
						l += pcs.borderLeftStyle != none ? px(node, pcs.borderLeftWidth) : 0;
						t += pcs.borderTopStyle != none ? px(node, pcs.borderTopWidth) : 0;
					}
				}
			}
		}else if( 0  || (has("ie") == 8 && ! 0 )){
			// On Opera and IE 8, offsetLeft/Top includes the parent's border
			if(p){
				pcs = style.getComputedStyle(p);
				l -= pcs.borderLeftStyle != none ? px(node, pcs.borderLeftWidth) : 0;
				t -= pcs.borderTopStyle != none ? px(node, pcs.borderTopWidth) : 0;
			}
		}
		return {l: l, t: t, w: node.offsetWidth + me.w, h: node.offsetHeight + me.h};
	};

	geom.getContentBox = function getContentBox(node, computedStyle){
		// summary:
		//		Returns an object that encodes the width, height, left and top
		//		positions of the node's content box, irrespective of the
		//		current box model.
		// node: DOMNode
		// computedStyle: Object?
		//		This parameter accepts computed styles object.
		//		If this parameter is omitted, the functions will call
		//		dojo.getComputedStyle to get one. It is a better way, calling
		//		dojo.computedStyle once, and then pass the reference to this
		//		computedStyle parameter. Wherever possible, reuse the returned
		//		object of dojo/dom-style.getComputedStyle().

		// clientWidth/Height are important since the automatically account for scrollbars
		// fallback to offsetWidth/Height for special cases (see #3378)
		node = dom.byId(node);
		var s = computedStyle || style.getComputedStyle(node), w = node.clientWidth, h,
			pe = geom.getPadExtents(node, s), be = geom.getBorderExtents(node, s);
		if(!w){
			w = node.offsetWidth;
			h = node.offsetHeight;
		}else{
			h = node.clientHeight;
			be.w = be.h = 0;
		}
		// On Opera, offsetLeft includes the parent's border
		if( 0 ){
			pe.l += be.l;
			pe.t += be.t;
		}
		return {l: pe.l, t: pe.t, w: w - pe.w - be.w, h: h - pe.h - be.h};
	};

	// Box setters depend on box context because interpretation of width/height styles
	// vary wrt box context.
	//
	// The value of boxModel is used to determine box context.
	// boxModel can be set directly to change behavior.
	//
	// Beware of display: inline objects that have padding styles
	// because the user agent ignores padding (it's a bogus setup anyway)
	//
	// Be careful with IMGs because they are inline or block depending on
	// browser and browser mode.
	//
	// Elements other than DIV may have special quirks, like built-in
	// margins or padding, or values not detectable via computedStyle.
	// In particular, margins on TABLE do not seems to appear
	// at all in computedStyle on Mozilla.

	function setBox(/*DomNode*/ node, /*Number?*/ l, /*Number?*/ t, /*Number?*/ w, /*Number?*/ h, /*String?*/ u){
		// summary:
		//		sets width/height/left/top in the current (native) box-model
		//		dimensions. Uses the unit passed in u.
		// node:
		//		DOM Node reference. Id string not supported for performance
		//		reasons.
		// l:
		//		left offset from parent.
		// t:
		//		top offset from parent.
		// w:
		//		width in current box model.
		// h:
		//		width in current box model.
		// u:
		//		unit measure to use for other measures. Defaults to "px".
		u = u || "px";
		var s = node.style;
		if(!isNaN(l)){
			s.left = l + u;
		}
		if(!isNaN(t)){
			s.top = t + u;
		}
		if(w >= 0){
			s.width = w + u;
		}
		if(h >= 0){
			s.height = h + u;
		}
	}

	function isButtonTag(/*DomNode*/ node){
		// summary:
		//		True if the node is BUTTON or INPUT.type="button".
		return node.tagName.toLowerCase() == "button" ||
			node.tagName.toLowerCase() == "input" && (node.getAttribute("type") || "").toLowerCase() == "button"; // boolean
	}

	function usesBorderBox(/*DomNode*/ node){
		// summary:
		//		True if the node uses border-box layout.

		// We could test the computed style of node to see if a particular box
		// has been specified, but there are details and we choose not to bother.

		// TABLE and BUTTON (and INPUT type=button) are always border-box by default.
		// If you have assigned a different box to either one via CSS then
		// box functions will break.

		return geom.boxModel == "border-box" || node.tagName.toLowerCase() == "table" || isButtonTag(node); // boolean
	}

	geom.setContentSize = function setContentSize(/*DomNode*/ node, /*Object*/ box, /*Object*/ computedStyle){
		// summary:
		//		Sets the size of the node's contents, irrespective of margins,
		//		padding, or borders.
		// node: DOMNode
		// box: Object
		//		hash with optional "w", and "h" properties for "width", and "height"
		//		respectively. All specified properties should have numeric values in whole pixels.
		// computedStyle: Object?
		//		This parameter accepts computed styles object.
		//		If this parameter is omitted, the functions will call
		//		dojo.getComputedStyle to get one. It is a better way, calling
		//		dojo.computedStyle once, and then pass the reference to this
		//		computedStyle parameter. Wherever possible, reuse the returned
		//		object of dojo/dom-style.getComputedStyle().

		node = dom.byId(node);
		var w = box.w, h = box.h;
		if(usesBorderBox(node)){
			var pb = geom.getPadBorderExtents(node, computedStyle);
			if(w >= 0){
				w += pb.w;
			}
			if(h >= 0){
				h += pb.h;
			}
		}
		setBox(node, NaN, NaN, w, h);
	};

	var nilExtents = {l: 0, t: 0, w: 0, h: 0};

	geom.setMarginBox = function setMarginBox(/*DomNode*/ node, /*Object*/ box, /*Object*/ computedStyle){
		// summary:
		//		sets the size of the node's margin box and placement
		//		(left/top), irrespective of box model. Think of it as a
		//		passthrough to setBox that handles box-model vagaries for
		//		you.
		// node: DOMNode
		// box: Object
		//		hash with optional "l", "t", "w", and "h" properties for "left", "right", "width", and "height"
		//		respectively. All specified properties should have numeric values in whole pixels.
		// computedStyle: Object?
		//		This parameter accepts computed styles object.
		//		If this parameter is omitted, the functions will call
		//		dojo.getComputedStyle to get one. It is a better way, calling
		//		dojo.computedStyle once, and then pass the reference to this
		//		computedStyle parameter. Wherever possible, reuse the returned
		//		object of dojo/dom-style.getComputedStyle().

		node = dom.byId(node);
		var s = computedStyle || style.getComputedStyle(node), w = box.w, h = box.h,
		// Some elements have special padding, margin, and box-model settings.
		// To use box functions you may need to set padding, margin explicitly.
		// Controlling box-model is harder, in a pinch you might set dojo/dom-geometry.boxModel.
			pb = usesBorderBox(node) ? nilExtents : geom.getPadBorderExtents(node, s),
			mb = geom.getMarginExtents(node, s);
		if(has("webkit")){
			// on Safari (3.1.2), button nodes with no explicit size have a default margin
			// setting an explicit size eliminates the margin.
			// We have to swizzle the width to get correct margin reading.
			if(isButtonTag(node)){
				var ns = node.style;
				if(w >= 0 && !ns.width){
					ns.width = "4px";
				}
				if(h >= 0 && !ns.height){
					ns.height = "4px";
				}
			}
		}
		if(w >= 0){
			w = Math.max(w - pb.w - mb.w, 0);
		}
		if(h >= 0){
			h = Math.max(h - pb.h - mb.h, 0);
		}
		setBox(node, box.l, box.t, w, h);
	};

	// =============================
	// Positioning
	// =============================

	geom.isBodyLtr = function isBodyLtr(/*Document?*/ doc){
		// summary:
		//		Returns true if the current language is left-to-right, and false otherwise.
		// doc: Document?
		//		Optional document to query.   If unspecified, use win.doc.
		// returns: Boolean

		doc = doc || win.doc;
		return (win.body(doc).dir || doc.documentElement.dir || "ltr").toLowerCase() == "ltr"; // Boolean
	};

	geom.docScroll = function docScroll(/*Document?*/ doc){
		// summary:
		//		Returns an object with {node, x, y} with corresponding offsets.
		// doc: Document?
		//		Optional document to query.   If unspecified, use win.doc.
		// returns: Object

		doc = doc || win.doc;
		var node = win.doc.parentWindow || win.doc.defaultView;   // use UI window, not dojo.global window.   TODO: use dojo/window::get() except for circular dependency problem
		return "pageXOffset" in node ? {x: node.pageXOffset, y: node.pageYOffset } :
			(node =  0  ? win.body(doc) : doc.documentElement) &&
				{x: geom.fixIeBiDiScrollLeft(node.scrollLeft || 0, doc), y: node.scrollTop || 0 };
	};

	if(has("ie")){
		geom.getIeDocumentElementOffset = function getIeDocumentElementOffset(/*Document?*/ doc){
			// summary:
			//		returns the offset in x and y from the document body to the
			//		visual edge of the page for IE
			// doc: Document?
			//		Optional document to query.   If unspecified, use win.doc.
			// description:
			//		The following values in IE contain an offset:
			//	|		event.clientX
			//	|		event.clientY
			//	|		node.getBoundingClientRect().left
			//	|		node.getBoundingClientRect().top
			//		But other position related values do not contain this offset,
			//		such as node.offsetLeft, node.offsetTop, node.style.left and
			//		node.style.top. The offset is always (2, 2) in LTR direction.
			//		When the body is in RTL direction, the offset counts the width
			//		of left scroll bar's width.  This function computes the actual
			//		offset.

			//NOTE: assumes we're being called in an IE browser

			doc = doc || win.doc;
			var de = doc.documentElement; // only deal with HTML element here, position() handles body/quirks

			if(has("ie") < 8){
				var r = de.getBoundingClientRect(), // works well for IE6+
					l = r.left, t = r.top;
				if(has("ie") < 7){
					l += de.clientLeft;	// scrollbar size in strict/RTL, or,
					t += de.clientTop;	// HTML border size in strict
				}
				return {
					x: l < 0 ? 0 : l, // FRAME element border size can lead to inaccurate negative values
					y: t < 0 ? 0 : t
				};
			}else{
				return {
					x: 0,
					y: 0
				};
			}
		};
	}

	geom.fixIeBiDiScrollLeft = function fixIeBiDiScrollLeft(/*Integer*/ scrollLeft, /*Document?*/ doc){
		// summary:
		//		In RTL direction, scrollLeft should be a negative value, but IE
		//		returns a positive one. All codes using documentElement.scrollLeft
		//		must call this function to fix this error, otherwise the position
		//		will offset to right when there is a horizontal scrollbar.
		// scrollLeft: Number
		// doc: Document?
		//		Optional document to query.   If unspecified, use win.doc.
		// returns: Number

		// In RTL direction, scrollLeft should be a negative value, but IE
		// returns a positive one. All codes using documentElement.scrollLeft
		// must call this function to fix this error, otherwise the position
		// will offset to right when there is a horizontal scrollbar.

		doc = doc || win.doc;
		var ie = has("ie");
		if(ie && !geom.isBodyLtr(doc)){
			var qk =  0 ,
				de = qk ? win.body(doc) : doc.documentElement,
				pwin = win.global;	// TODO: use winUtils.get(doc) after resolving circular dependency b/w dom-geometry.js and dojo/window.js
			if(ie == 6 && !qk && pwin.frameElement && de.scrollHeight > de.clientHeight){
				scrollLeft += de.clientLeft; // workaround ie6+strict+rtl+iframe+vertical-scrollbar bug where clientWidth is too small by clientLeft pixels
			}
			return (ie < 8 || qk) ? (scrollLeft + de.clientWidth - de.scrollWidth) : -scrollLeft; // Integer
		}
		return scrollLeft; // Integer
	};

	geom.position = function(/*DomNode*/ node, /*Boolean?*/ includeScroll){
		// summary:
		//		Gets the position and size of the passed element relative to
		//		the viewport (if includeScroll==false), or relative to the
		//		document root (if includeScroll==true).
		//
		// description:
		//		Returns an object of the form:
		//		`{ x: 100, y: 300, w: 20, h: 15 }`.
		//		If includeScroll==true, the x and y values will include any
		//		document offsets that may affect the position relative to the
		//		viewport.
		//		Uses the border-box model (inclusive of border and padding but
		//		not margin).  Does not act as a setter.
		// node: DOMNode|String
		// includeScroll: Boolean?
		// returns: Object

		node = dom.byId(node);
		var	db = win.body(node.ownerDocument),
			ret = node.getBoundingClientRect();
		ret = {x: ret.left, y: ret.top, w: ret.right - ret.left, h: ret.bottom - ret.top};

		if(has("ie") < 9){
			// On IE<9 there's a 2px offset that we need to adjust for, see dojo.getIeDocumentElementOffset()
			var offset = geom.getIeDocumentElementOffset(node.ownerDocument);

			// fixes the position in IE, quirks mode
			ret.x -= offset.x + ( 0  ? db.clientLeft + db.offsetLeft : 0);
			ret.y -= offset.y + ( 0  ? db.clientTop + db.offsetTop : 0);
		}

		// account for document scrolling
		// if offsetParent is used, ret value already includes scroll position
		// so we may have to actually remove that value if !includeScroll
		if(includeScroll){
			var scroll = geom.docScroll(node.ownerDocument);
			ret.x += scroll.x;
			ret.y += scroll.y;
		}

		return ret; // Object
	};

	// random "private" functions wildly used throughout the toolkit

	geom.getMarginSize = function getMarginSize(/*DomNode*/ node, /*Object*/ computedStyle){
		// summary:
		//		returns an object that encodes the width and height of
		//		the node's margin box
		// node: DOMNode|String
		// computedStyle: Object?
		//		This parameter accepts computed styles object.
		//		If this parameter is omitted, the functions will call
		//		dojo.getComputedStyle to get one. It is a better way, calling
		//		dojo.computedStyle once, and then pass the reference to this
		//		computedStyle parameter. Wherever possible, reuse the returned
		//		object of dojo/dom-style.getComputedStyle().

		node = dom.byId(node);
		var me = geom.getMarginExtents(node, computedStyle || style.getComputedStyle(node));
		var size = node.getBoundingClientRect();
		return {
			w: (size.right - size.left) + me.w,
			h: (size.bottom - size.top) + me.h
		};
	};

	geom.normalizeEvent = function(event){
		// summary:
		//		Normalizes the geometry of a DOM event, normalizing the pageX, pageY,
		//		offsetX, offsetY, layerX, and layerX properties
		// event: Object
		if(!("layerX" in event)){
			event.layerX = event.offsetX;
			event.layerY = event.offsetY;
		}
		if(!has("dom-addeventlistener")){
			// old IE version
			// FIXME: scroll position query is duped from dojo.html to
			// avoid dependency on that entire module. Now that HTML is in
			// Base, we should convert back to something similar there.
			var se = event.target;
			var doc = (se && se.ownerDocument) || document;
			// DO NOT replace the following to use dojo.body(), in IE, document.documentElement should be used
			// here rather than document.body
			var docBody =  0  ? doc.body : doc.documentElement;
			var offset = geom.getIeDocumentElementOffset(doc);
			event.pageX = event.clientX + geom.fixIeBiDiScrollLeft(docBody.scrollLeft || 0, doc) - offset.x;
			event.pageY = event.clientY + (docBody.scrollTop || 0) - offset.y;
		}
	};

	// TODO: evaluate separate getters/setters for position and sizes?

	return geom;
});

},
'dojo/dom':function(){
define(["./sniff", "./_base/window"],
		function(has, win){
	// module:
	//		dojo/dom

	// FIXME: need to add unit tests for all the semi-public methods

	if(has("ie") <= 7){
		try{
			document.execCommand("BackgroundImageCache", false, true);
		}catch(e){
			// sane browsers don't have cache "issues"
		}
	}

	// =============================
	// DOM Functions
	// =============================

	// the result object
	var dom = {
		// summary:
		//		This module defines the core dojo DOM API.
	};

	if(has("ie")){
		dom.byId = function(id, doc){
			if(typeof id != "string"){
				return id;
			}
			var _d = doc || win.doc, te = id && _d.getElementById(id);
			// attributes.id.value is better than just id in case the
			// user has a name=id inside a form
			if(te && (te.attributes.id.value == id || te.id == id)){
				return te;
			}else{
				var eles = _d.all[id];
				if(!eles || eles.nodeName){
					eles = [eles];
				}
				// if more than 1, choose first with the correct id
				var i = 0;
				while((te = eles[i++])){
					if((te.attributes && te.attributes.id && te.attributes.id.value == id) || te.id == id){
						return te;
					}
				}
			}
		};
	}else{
		dom.byId = function(id, doc){
			// inline'd type check.
			// be sure to return null per documentation, to match IE branch.
			return ((typeof id == "string") ? (doc || win.doc).getElementById(id) : id) || null; // DOMNode
		};
	}
	/*=====
	 dom.byId = function(id, doc){
		 // summary:
		 //		Returns DOM node with matching `id` attribute or falsy value (ex: null or undefined)
		 //		if not found.  If `id` is a DomNode, this function is a no-op.
		 //
		 // id: String|DOMNode
		 //		A string to match an HTML id attribute or a reference to a DOM Node
		 //
		 // doc: Document?
		 //		Document to work in. Defaults to the current value of
		 //		dojo.doc.  Can be used to retrieve
		 //		node references from other documents.
		 //
		 // example:
		 //		Look up a node by ID:
		 //	|	var n = dojo.byId("foo");
		 //
		 // example:
		 //		Check if a node exists, and use it.
		 //	|	var n = dojo.byId("bar");
		 //	|	if(n){ doStuff() ... }
		 //
		 // example:
		 //		Allow string or DomNode references to be passed to a custom function:
		 //	|	var foo = function(nodeOrId){
		 //	|		nodeOrId = dojo.byId(nodeOrId);
		 //	|		// ... more stuff
		 //	|	}
	 };
	 =====*/

	dom.isDescendant = function(/*DOMNode|String*/ node, /*DOMNode|String*/ ancestor){
		// summary:
		//		Returns true if node is a descendant of ancestor
		// node: DOMNode|String
		//		string id or node reference to test
		// ancestor: DOMNode|String
		//		string id or node reference of potential parent to test against
		//
		// example:
		//		Test is node id="bar" is a descendant of node id="foo"
		//	|	if(dojo.isDescendant("bar", "foo")){ ... }

		try{
			node = dom.byId(node);
			ancestor = dom.byId(ancestor);
			while(node){
				if(node == ancestor){
					return true; // Boolean
				}
				node = node.parentNode;
			}
		}catch(e){ /* squelch, return false */ }
		return false; // Boolean
	};


	// TODO: do we need setSelectable in the base?

	// Add feature test for user-select CSS property
	// (currently known to work in all but IE < 10 and Opera)
	has.add("css-user-select", function(global, doc, element){
		// Avoid exception when dom.js is loaded in non-browser environments
		if(!element){ return false; }
		
		var style = element.style;
		var prefixes = ["Khtml", "O", "ms", "Moz", "Webkit"],
			i = prefixes.length,
			name = "userSelect",
			prefix;

		// Iterate prefixes from most to least likely
		do{
			if(typeof style[name] !== "undefined"){
				// Supported; return property name
				return name;
			}
		}while(i-- && (name = prefixes[i] + "UserSelect"));

		// Not supported if we didn't return before now
		return false;
	});

	/*=====
	dom.setSelectable = function(node, selectable){
		// summary:
		//		Enable or disable selection on a node
		// node: DOMNode|String
		//		id or reference to node
		// selectable: Boolean
		//		state to put the node in. false indicates unselectable, true
		//		allows selection.
		// example:
		//		Make the node id="bar" unselectable
		//	|	dojo.setSelectable("bar");
		// example:
		//		Make the node id="bar" selectable
		//	|	dojo.setSelectable("bar", true);
	};
	=====*/

	var cssUserSelect = has("css-user-select");
	dom.setSelectable = cssUserSelect ? function(node, selectable){
		// css-user-select returns a (possibly vendor-prefixed) CSS property name
		dom.byId(node).style[cssUserSelect] = selectable ? "" : "none";
	} : function(node, selectable){
		node = dom.byId(node);

		// (IE < 10 / Opera) Fall back to setting/removing the
		// unselectable attribute on the element and all its children
		var nodes = node.getElementsByTagName("*"),
			i = nodes.length;

		if(selectable){
			node.removeAttribute("unselectable");
			while(i--){
				nodes[i].removeAttribute("unselectable");
			}
		}else{
			node.setAttribute("unselectable", "on");
			while(i--){
				nodes[i].setAttribute("unselectable", "on");
			}
		}
	};

	return dom;
});

},
'dojo/dom-style':function(){
define(["./sniff", "./dom"], function(has, dom){
	// module:
	//		dojo/dom-style

	// =============================
	// Style Functions
	// =============================

	// getComputedStyle drives most of the style code.
	// Wherever possible, reuse the returned object.
	//
	// API functions below that need to access computed styles accept an
	// optional computedStyle parameter.
	// If this parameter is omitted, the functions will call getComputedStyle themselves.
	// This way, calling code can access computedStyle once, and then pass the reference to
	// multiple API functions.

	// Although we normally eschew argument validation at this
	// level, here we test argument 'node' for (duck)type,
	// by testing nodeType, ecause 'document' is the 'parentNode' of 'body'
	// it is frequently sent to this function even
	// though it is not Element.
	var getComputedStyle, style = {
		// summary:
		//		This module defines the core dojo DOM style API.
	};
	if(has("webkit")){
		getComputedStyle = function(/*DomNode*/ node){
			var s;
			if(node.nodeType == 1){
				var dv = node.ownerDocument.defaultView;
				s = dv.getComputedStyle(node, null);
				if(!s && node.style){
					node.style.display = "";
					s = dv.getComputedStyle(node, null);
				}
			}
			return s || {};
		};
	}else if(has("ie") && (has("ie") < 9 ||  0 )){
		getComputedStyle = function(node){
			// IE (as of 7) doesn't expose Element like sane browsers
			// currentStyle can be null on IE8!
			return node.nodeType == 1 /* ELEMENT_NODE*/ && node.currentStyle ? node.currentStyle : {};
		};
	}else{
		getComputedStyle = function(node){
			return node.nodeType == 1 /* ELEMENT_NODE*/ ?
				node.ownerDocument.defaultView.getComputedStyle(node, null) : {};
		};
	}
	style.getComputedStyle = getComputedStyle;
	/*=====
	style.getComputedStyle = function(node){
		// summary:
		//		Returns a "computed style" object.
		//
		// description:
		//		Gets a "computed style" object which can be used to gather
		//		information about the current state of the rendered node.
		//
		//		Note that this may behave differently on different browsers.
		//		Values may have different formats and value encodings across
		//		browsers.
		//
		//		Note also that this method is expensive.  Wherever possible,
		//		reuse the returned object.
		//
		//		Use the dojo.style() method for more consistent (pixelized)
		//		return values.
		//
		// node: DOMNode
		//		A reference to a DOM node. Does NOT support taking an
		//		ID string for speed reasons.
		// example:
		//	|	dojo.getComputedStyle(dojo.byId('foo')).borderWidth;
		//
		// example:
		//		Reusing the returned object, avoiding multiple lookups:
		//	|	var cs = dojo.getComputedStyle(dojo.byId("someNode"));
		//	|	var w = cs.width, h = cs.height;
		return; // CSS2Properties
	};
	=====*/

	var toPixel;
	if(!has("ie")){
		toPixel = function(element, value){
			// style values can be floats, client code may want
			// to round for integer pixels.
			return parseFloat(value) || 0;
		};
	}else{
		toPixel = function(element, avalue){
			if(!avalue){ return 0; }
			// on IE7, medium is usually 4 pixels
			if(avalue == "medium"){ return 4; }
			// style values can be floats, client code may
			// want to round this value for integer pixels.
			if(avalue.slice && avalue.slice(-2) == 'px'){ return parseFloat(avalue); }
			var s = element.style, rs = element.runtimeStyle, cs = element.currentStyle,
				sLeft = s.left, rsLeft = rs.left;
			rs.left = cs.left;
			try{
				// 'avalue' may be incompatible with style.left, which can cause IE to throw
				// this has been observed for border widths using "thin", "medium", "thick" constants
				// those particular constants could be trapped by a lookup
				// but perhaps there are more
				s.left = avalue;
				avalue = s.pixelLeft;
			}catch(e){
				avalue = 0;
			}
			s.left = sLeft;
			rs.left = rsLeft;
			return avalue;
		};
	}
	style.toPixelValue = toPixel;
	/*=====
	style.toPixelValue = function(node, value){
		// summary:
		//		converts style value to pixels on IE or return a numeric value.
		// node: DOMNode
		// value: String
		// returns: Number
	};
	=====*/

	// FIXME: there opacity quirks on FF that we haven't ported over. Hrm.

	var astr = "DXImageTransform.Microsoft.Alpha";
	var af = function(n, f){
		try{
			return n.filters.item(astr);
		}catch(e){
			return f ? {} : null;
		}
	};

	var _getOpacity =
		has("ie") < 9 || (has("ie") < 10 &&  0 ) ? function(node){
			try{
				return af(node).Opacity / 100; // Number
			}catch(e){
				return 1; // Number
			}
		} :
		function(node){
			return getComputedStyle(node).opacity;
		};

	var _setOpacity =
		has("ie") < 9 || (has("ie") < 10 &&  0 ) ? function(/*DomNode*/ node, /*Number*/ opacity){
			var ov = opacity * 100, opaque = opacity == 1;
			node.style.zoom = opaque ? "" : 1;

			if(!af(node)){
				if(opaque){
					return opacity;
				}
				node.style.filter += " progid:" + astr + "(Opacity=" + ov + ")";
			}else{
				af(node, 1).Opacity = ov;
			}

			// on IE7 Alpha(Filter opacity=100) makes text look fuzzy so disable it altogether (bug #2661),
			//but still update the opacity value so we can get a correct reading if it is read later.
			af(node, 1).Enabled = !opaque;

			if(node.tagName.toLowerCase() == "tr"){
				for(var td = node.firstChild; td; td = td.nextSibling){
					if(td.tagName.toLowerCase() == "td"){
						_setOpacity(td, opacity);
					}
				}
			}
			return opacity;
		} :
		function(node, opacity){
			return node.style.opacity = opacity;
		};

	var _pixelNamesCache = {
		left: true, top: true
	};
	var _pixelRegExp = /margin|padding|width|height|max|min|offset/; // |border
	function _toStyleValue(node, type, value){
		//TODO: should we really be doing string case conversion here? Should we cache it? Need to profile!
		type = type.toLowerCase();
		if(has("ie")){
			if(value == "auto"){
				if(type == "height"){ return node.offsetHeight; }
				if(type == "width"){ return node.offsetWidth; }
			}
			if(type == "fontweight"){
				switch(value){
					case 700: return "bold";
					case 400:
					default: return "normal";
				}
			}
		}
		if(!(type in _pixelNamesCache)){
			_pixelNamesCache[type] = _pixelRegExp.test(type);
		}
		return _pixelNamesCache[type] ? toPixel(node, value) : value;
	}

	var _floatStyle = has("ie") ? "styleFloat" : "cssFloat",
		_floatAliases = {"cssFloat": _floatStyle, "styleFloat": _floatStyle, "float": _floatStyle};

	// public API

	style.get = function getStyle(/*DOMNode|String*/ node, /*String?*/ name){
		// summary:
		//		Accesses styles on a node.
		// description:
		//		Getting the style value uses the computed style for the node, so the value
		//		will be a calculated value, not just the immediate node.style value.
		//		Also when getting values, use specific style names,
		//		like "borderBottomWidth" instead of "border" since compound values like
		//		"border" are not necessarily reflected as expected.
		//		If you want to get node dimensions, use `dojo.marginBox()`,
		//		`dojo.contentBox()` or `dojo.position()`.
		// node: DOMNode|String
		//		id or reference to node to get style for
		// name: String?
		//		the style property to get
		// example:
		//		Passing only an ID or node returns the computed style object of
		//		the node:
		//	|	dojo.getStyle("thinger");
		// example:
		//		Passing a node and a style property returns the current
		//		normalized, computed value for that property:
		//	|	dojo.getStyle("thinger", "opacity"); // 1 by default

		var n = dom.byId(node), l = arguments.length, op = (name == "opacity");
		if(l == 2 && op){
			return _getOpacity(n);
		}
		name = _floatAliases[name] || name;
		var s = style.getComputedStyle(n);
		return (l == 1) ? s : _toStyleValue(n, name, s[name] || n.style[name]); /* CSS2Properties||String||Number */
	};

	style.set = function setStyle(/*DOMNode|String*/ node, /*String|Object*/ name, /*String?*/ value){
		// summary:
		//		Sets styles on a node.
		// node: DOMNode|String
		//		id or reference to node to set style for
		// name: String|Object
		//		the style property to set in DOM-accessor format
		//		("borderWidth", not "border-width") or an object with key/value
		//		pairs suitable for setting each property.
		// value: String?
		//		If passed, sets value on the node for style, handling
		//		cross-browser concerns.  When setting a pixel value,
		//		be sure to include "px" in the value. For instance, top: "200px".
		//		Otherwise, in some cases, some browsers will not apply the style.
		//
		// example:
		//		Passing a node, a style property, and a value changes the
		//		current display of the node and returns the new computed value
		//	|	dojo.setStyle("thinger", "opacity", 0.5); // == 0.5
		//
		// example:
		//		Passing a node, an object-style style property sets each of the values in turn and returns the computed style object of the node:
		//	|	dojo.setStyle("thinger", {
		//	|		"opacity": 0.5,
		//	|		"border": "3px solid black",
		//	|		"height": "300px"
		//	|	});
		//
		// example:
		//		When the CSS style property is hyphenated, the JavaScript property is camelCased.
		//		font-size becomes fontSize, and so on.
		//	|	dojo.setStyle("thinger",{
		//	|		fontSize:"14pt",
		//	|		letterSpacing:"1.2em"
		//	|	});
		//
		// example:
		//		dojo/NodeList implements .style() using the same syntax, omitting the "node" parameter, calling
		//		dojo.style() on every element of the list. See: `dojo.query()` and `dojo/NodeList`
		//	|	dojo.query(".someClassName").style("visibility","hidden");
		//	|	// or
		//	|	dojo.query("#baz > div").style({
		//	|		opacity:0.75,
		//	|		fontSize:"13pt"
		//	|	});

		var n = dom.byId(node), l = arguments.length, op = (name == "opacity");
		name = _floatAliases[name] || name;
		if(l == 3){
			return op ? _setOpacity(n, value) : n.style[name] = value; // Number
		}
		for(var x in name){
			style.set(node, x, name[x]);
		}
		return style.getComputedStyle(n);
	};

	return style;
});

},
'dojo/mouse':function(){
define(["./_base/kernel", "./on", "./has", "./dom", "./_base/window"], function(dojo, on, has, dom, win){

	// module:
	//		dojo/mouse

    has.add("dom-quirks", win.doc && win.doc.compatMode == "BackCompat");
	has.add("events-mouseenter", win.doc && "onmouseenter" in win.doc.createElement("div"));
	has.add("events-mousewheel", win.doc && 'onmousewheel' in win.doc);

	var mouseButtons;
	if((has("dom-quirks") && has("ie")) || !has("dom-addeventlistener")){
		mouseButtons = {
			LEFT:   1,
			MIDDLE: 4,
			RIGHT:  2,
			// helper functions
			isButton: function(e, button){ return e.button & button; },
			isLeft:   function(e){ return e.button & 1; },
			isMiddle: function(e){ return e.button & 4; },
			isRight:  function(e){ return e.button & 2; }
		};
	}else{
		mouseButtons = {
			LEFT:   0,
			MIDDLE: 1,
			RIGHT:  2,
			// helper functions
			isButton: function(e, button){ return e.button == button; },
			isLeft:   function(e){ return e.button == 0; },
			isMiddle: function(e){ return e.button == 1; },
			isRight:  function(e){ return e.button == 2; }
		};
	}
	dojo.mouseButtons = mouseButtons;

/*=====
	dojo.mouseButtons = {
		// LEFT: Number
		//		Numeric value of the left mouse button for the platform.
		LEFT:   0,
		// MIDDLE: Number
		//		Numeric value of the middle mouse button for the platform.
		MIDDLE: 1,
		// RIGHT: Number
		//		Numeric value of the right mouse button for the platform.
		RIGHT:  2,

		isButton: function(e, button){
			// summary:
			//		Checks an event object for a pressed button
			// e: Event
			//		Event object to examine
			// button: Number
			//		The button value (example: dojo.mouseButton.LEFT)
			return e.button == button; // Boolean
		},
		isLeft: function(e){
			// summary:
			//		Checks an event object for the pressed left button
			// e: Event
			//		Event object to examine
			return e.button == 0; // Boolean
		},
		isMiddle: function(e){
			// summary:
			//		Checks an event object for the pressed middle button
			// e: Event
			//		Event object to examine
			return e.button == 1; // Boolean
		},
		isRight: function(e){
			// summary:
			//		Checks an event object for the pressed right button
			// e: Event
			//		Event object to examine
			return e.button == 2; // Boolean
		}
	};
=====*/

	function eventHandler(type, selectHandler){
		// emulation of mouseenter/leave with mouseover/out using descendant checking
		var handler = function(node, listener){
			return on(node, type, function(evt){
				if(selectHandler){
					return selectHandler(evt, listener);
				}
				if(!dom.isDescendant(evt.relatedTarget, node)){
					return listener.call(this, evt);
				}
			});
		};
		handler.bubble = function(select){
			return eventHandler(type, function(evt, listener){
				// using a selector, use the select function to determine if the mouse moved inside the selector and was previously outside the selector
				var target = select(evt.target);
				var relatedTarget = evt.relatedTarget;
				if(target && (target != (relatedTarget && relatedTarget.nodeType == 1 && select(relatedTarget)))){
					return listener.call(target, evt);
				} 
			});
		};
		return handler;
	}
	var wheel;
	if(has("events-mousewheel")){
		wheel = 'mousewheel';
	}else{ //firefox
		wheel = function(node, listener){
			return on(node, 'DOMMouseScroll', function(evt){
				evt.wheelDelta = -evt.detail;
				listener.call(this, evt);
			});
		};
	}
	return {
		// summary:
		//		This module provide mouse event handling utility functions and exports
		//		mouseenter and mouseleave event emulation.
		// example:
		//		To use these events, you register a mouseenter like this:
		//		|	define(["dojo/on", dojo/mouse"], function(on, mouse){
		//		|		on(targetNode, mouse.enter, function(event){
		//		|			dojo.addClass(targetNode, "highlighted");
		//		|		});
		//		|		on(targetNode, mouse.leave, function(event){
		//		|			dojo.removeClass(targetNode, "highlighted");
		//		|		});

		_eventHandler: eventHandler,		// for dojo/touch

		// enter: Synthetic Event
		//		This is an extension event for the mouseenter that IE provides, emulating the
		//		behavior on other browsers.
		enter: eventHandler("mouseover"),

		// leave: Synthetic Event
		//		This is an extension event for the mouseleave that IE provides, emulating the
		//		behavior on other browsers.
		leave: eventHandler("mouseout"),

		// wheel: Normalized Mouse Wheel Event
		//		This is an extension event for the mousewheel that non-Mozilla browsers provide,
		//		emulating the behavior on Mozilla based browsers.
		wheel: wheel,

		isLeft: mouseButtons.isLeft,
		/*=====
		isLeft: function(){
			// summary:
			//		Test an event object (from a mousedown event) to see if the left button was pressed.
		},
		=====*/

		isMiddle: mouseButtons.isMiddle,
		/*=====
		 isMiddle: function(){
			 // summary:
			 //		Test an event object (from a mousedown event) to see if the middle button was pressed.
		 },
		 =====*/

		isRight: mouseButtons.isRight
		/*=====
		 , isRight: function(){
			 // summary:
			 //		Test an event object (from a mousedown event) to see if the right button was pressed.
		 }
		 =====*/
	};
});

},
'dojo/_base/sniff':function(){
define(["./kernel", "./lang", "../sniff"], function(dojo, lang, has){
	// module:
	//		dojo/_base/sniff

	/*=====
	return {
		// summary:
		//		Deprecated.   New code should use dojo/sniff.
		//		This module populates the dojo browser version sniffing properties like dojo.isIE.
	};
	=====*/

	if(! 1 ){
		return has;
	}

	// no idea what this is for, or if it's used
	dojo._name = "browser";

	lang.mixin(dojo, {
		// isBrowser: Boolean
		//		True if the client is a web-browser
		isBrowser: true,

		// isFF: Number|undefined
		//		Version as a Number if client is FireFox. undefined otherwise. Corresponds to
		//		major detected FireFox version (1.5, 2, 3, etc.)
		isFF: has("ff"),

		// isIE: Number|undefined
		//		Version as a Number if client is MSIE(PC). undefined otherwise. Corresponds to
		//		major detected IE version (6, 7, 8, etc.)
		isIE: has("ie"),

		// isKhtml: Number|undefined
		//		Version as a Number if client is a KHTML browser. undefined otherwise. Corresponds to major
		//		detected version.
		isKhtml: has("khtml"),

		// isWebKit: Number|undefined
		//		Version as a Number if client is a WebKit-derived browser (Konqueror,
		//		Safari, Chrome, etc.). undefined otherwise.
		isWebKit: has("webkit"),

		// isMozilla: Number|undefined
		//		Version as a Number if client is a Mozilla-based browser (Firefox,
		//		SeaMonkey). undefined otherwise. Corresponds to major detected version.
		isMozilla: has("mozilla"),
		// isMoz: Number|undefined
		//		Version as a Number if client is a Mozilla-based browser (Firefox,
		//		SeaMonkey). undefined otherwise. Corresponds to major detected version.
		isMoz: has("mozilla"),

		// isOpera: Number|undefined
		//		Version as a Number if client is Opera. undefined otherwise. Corresponds to
		//		major detected version.
		isOpera:  0 ,

		// isSafari: Number|undefined
		//		Version as a Number if client is Safari or iPhone. undefined otherwise.
		isSafari: has("safari"),

		// isChrome: Number|undefined
		//		Version as a Number if client is Chrome browser. undefined otherwise.
		isChrome: has("chrome"),

		// isMac: Boolean
		//		True if the client runs on Mac
		isMac: has("mac"),

		// isIos: Boolean
		//		True if client is iPhone, iPod, or iPad
		isIos: has("ios"),

		// isAndroid: Number|undefined
		//		Version as a Number if client is android browser. undefined otherwise.
		isAndroid: has("android"),

		// isWii: Boolean
		//		True if client is Wii
		isWii: has("wii"),

		// isQuirks: Boolean
		//		Page is in quirks mode.
		isQuirks:  0 ,

		// isAir: Boolean
		//		True if client is Adobe Air
		isAir: has("air")
	});


	dojo.locale = dojo.locale || (has("ie") ? navigator.userLanguage : navigator.language).toLowerCase();

	return has;
});

},
'dojo/keys':function(){
define(["./_base/kernel", "./sniff"], function(dojo, has){

	// module:
	//		dojo/keys

	return dojo.keys = {
		// summary:
		//		Definitions for common key values.  Client code should test keyCode against these named constants,
		//		as the actual codes can vary by browser.

		BACKSPACE: 8,
		TAB: 9,
		CLEAR: 12,
		ENTER: 13,
		SHIFT: 16,
		CTRL: 17,
		ALT: 18,
		META: has("webkit") ? 91 : 224,		// the apple key on macs
		PAUSE: 19,
		CAPS_LOCK: 20,
		ESCAPE: 27,
		SPACE: 32,
		PAGE_UP: 33,
		PAGE_DOWN: 34,
		END: 35,
		HOME: 36,
		LEFT_ARROW: 37,
		UP_ARROW: 38,
		RIGHT_ARROW: 39,
		DOWN_ARROW: 40,
		INSERT: 45,
		DELETE: 46,
		HELP: 47,
		LEFT_WINDOW: 91,
		RIGHT_WINDOW: 92,
		SELECT: 93,
		NUMPAD_0: 96,
		NUMPAD_1: 97,
		NUMPAD_2: 98,
		NUMPAD_3: 99,
		NUMPAD_4: 100,
		NUMPAD_5: 101,
		NUMPAD_6: 102,
		NUMPAD_7: 103,
		NUMPAD_8: 104,
		NUMPAD_9: 105,
		NUMPAD_MULTIPLY: 106,
		NUMPAD_PLUS: 107,
		NUMPAD_ENTER: 108,
		NUMPAD_MINUS: 109,
		NUMPAD_PERIOD: 110,
		NUMPAD_DIVIDE: 111,
		F1: 112,
		F2: 113,
		F3: 114,
		F4: 115,
		F5: 116,
		F6: 117,
		F7: 118,
		F8: 119,
		F9: 120,
		F10: 121,
		F11: 122,
		F12: 123,
		F13: 124,
		F14: 125,
		F15: 126,
		NUM_LOCK: 144,
		SCROLL_LOCK: 145,
		UP_DPAD: 175,
		DOWN_DPAD: 176,
		LEFT_DPAD: 177,
		RIGHT_DPAD: 178,
		// virtual key mapping
		copyKey: has("mac") && !has("air") ? (has("safari") ? 91 : 224 ) : 17
	};
});

},
'dojo/_base/declare':function(){
define(["./kernel", "../has", "./lang"], function(dojo, has, lang){
	// module:
	//		dojo/_base/declare

	var mix = lang.mixin, op = Object.prototype, opts = op.toString,
		xtor = new Function, counter = 0, cname = "constructor";

	function err(msg, cls){ throw new Error("declare" + (cls ? " " + cls : "") + ": " + msg); }

	// C3 Method Resolution Order (see http://www.python.org/download/releases/2.3/mro/)
	function c3mro(bases, className){
		var result = [], roots = [{cls: 0, refs: []}], nameMap = {}, clsCount = 1,
			l = bases.length, i = 0, j, lin, base, top, proto, rec, name, refs;

		// build a list of bases naming them if needed
		for(; i < l; ++i){
			base = bases[i];
			if(!base){
				err("mixin #" + i + " is unknown. Did you use dojo.require to pull it in?", className);
			}else if(opts.call(base) != "[object Function]"){
				err("mixin #" + i + " is not a callable constructor.", className);
			}
			lin = base._meta ? base._meta.bases : [base];
			top = 0;
			// add bases to the name map
			for(j = lin.length - 1; j >= 0; --j){
				proto = lin[j].prototype;
				if(!proto.hasOwnProperty("declaredClass")){
					proto.declaredClass = "uniqName_" + (counter++);
				}
				name = proto.declaredClass;
				if(!nameMap.hasOwnProperty(name)){
					nameMap[name] = {count: 0, refs: [], cls: lin[j]};
					++clsCount;
				}
				rec = nameMap[name];
				if(top && top !== rec){
					rec.refs.push(top);
					++top.count;
				}
				top = rec;
			}
			++top.count;
			roots[0].refs.push(top);
		}

		// remove classes without external references recursively
		while(roots.length){
			top = roots.pop();
			result.push(top.cls);
			--clsCount;
			// optimization: follow a single-linked chain
			while(refs = top.refs, refs.length == 1){
				top = refs[0];
				if(!top || --top.count){
					// branch or end of chain => do not end to roots
					top = 0;
					break;
				}
				result.push(top.cls);
				--clsCount;
			}
			if(top){
				// branch
				for(i = 0, l = refs.length; i < l; ++i){
					top = refs[i];
					if(!--top.count){
						roots.push(top);
					}
				}
			}
		}
		if(clsCount){
			err("can't build consistent linearization", className);
		}

		// calculate the superclass offset
		base = bases[0];
		result[0] = base ?
			base._meta && base === result[result.length - base._meta.bases.length] ?
				base._meta.bases.length : 1 : 0;

		return result;
	}

	function inherited(args, a, f){
		var name, chains, bases, caller, meta, base, proto, opf, pos,
			cache = this._inherited = this._inherited || {};

		// crack arguments
		if(typeof args == "string"){
			name = args;
			args = a;
			a = f;
		}
		f = 0;

		caller = args.callee;
		name = name || caller.nom;
		if(!name){
			err("can't deduce a name to call inherited()", this.declaredClass);
		}

		meta = this.constructor._meta;
		bases = meta.bases;

		pos = cache.p;
		if(name != cname){
			// method
			if(cache.c !== caller){
				// cache bust
				pos = 0;
				base = bases[0];
				meta = base._meta;
				if(meta.hidden[name] !== caller){
					// error detection
					chains = meta.chains;
					if(chains && typeof chains[name] == "string"){
						err("calling chained method with inherited: " + name, this.declaredClass);
					}
					// find caller
					do{
						meta = base._meta;
						proto = base.prototype;
						if(meta && (proto[name] === caller && proto.hasOwnProperty(name) || meta.hidden[name] === caller)){
							break;
						}
					}while(base = bases[++pos]); // intentional assignment
					pos = base ? pos : -1;
				}
			}
			// find next
			base = bases[++pos];
			if(base){
				proto = base.prototype;
				if(base._meta && proto.hasOwnProperty(name)){
					f = proto[name];
				}else{
					opf = op[name];
					do{
						proto = base.prototype;
						f = proto[name];
						if(f && (base._meta ? proto.hasOwnProperty(name) : f !== opf)){
							break;
						}
					}while(base = bases[++pos]); // intentional assignment
				}
			}
			f = base && f || op[name];
		}else{
			// constructor
			if(cache.c !== caller){
				// cache bust
				pos = 0;
				meta = bases[0]._meta;
				if(meta && meta.ctor !== caller){
					// error detection
					chains = meta.chains;
					if(!chains || chains.constructor !== "manual"){
						err("calling chained constructor with inherited", this.declaredClass);
					}
					// find caller
					while(base = bases[++pos]){ // intentional assignment
						meta = base._meta;
						if(meta && meta.ctor === caller){
							break;
						}
					}
					pos = base ? pos : -1;
				}
			}
			// find next
			while(base = bases[++pos]){	// intentional assignment
				meta = base._meta;
				f = meta ? meta.ctor : base;
				if(f){
					break;
				}
			}
			f = base && f;
		}

		// cache the found super method
		cache.c = f;
		cache.p = pos;

		// now we have the result
		if(f){
			return a === true ? f : f.apply(this, a || args);
		}
		// intentionally no return if a super method was not found
	}

	function getInherited(name, args){
		if(typeof name == "string"){
			return this.__inherited(name, args, true);
		}
		return this.__inherited(name, true);
	}

	function inherited__debug(args, a1, a2){
		var f = this.getInherited(args, a1);
		if(f){ return f.apply(this, a2 || a1 || args); }
		// intentionally no return if a super method was not found
	}

	var inheritedImpl = dojo.config.isDebug ? inherited__debug : inherited;

	// emulation of "instanceof"
	function isInstanceOf(cls){
		var bases = this.constructor._meta.bases;
		for(var i = 0, l = bases.length; i < l; ++i){
			if(bases[i] === cls){
				return true;
			}
		}
		return this instanceof cls;
	}

	function mixOwn(target, source){
		// add props adding metadata for incoming functions skipping a constructor
		for(var name in source){
			if(name != cname && source.hasOwnProperty(name)){
				target[name] = source[name];
			}
		}
		if(has("bug-for-in-skips-shadowed")){
			for(var extraNames= lang._extraNames, i= extraNames.length; i;){
				name = extraNames[--i];
				if(name != cname && source.hasOwnProperty(name)){
					  target[name] = source[name];
				}
			}
		}
	}

	// implementation of safe mixin function
	function safeMixin(target, source){
		// summary:
		//		Mix in properties skipping a constructor and decorating functions
		//		like it is done by declare().
		// target: Object
		//		Target object to accept new properties.
		// source: Object
		//		Source object for new properties.
		// description:
		//		This function is used to mix in properties like lang.mixin does,
		//		but it skips a constructor property and decorates functions like
		//		declare() does.
		//
		//		It is meant to be used with classes and objects produced with
		//		declare. Functions mixed in with dojo.safeMixin can use
		//		this.inherited() like normal methods.
		//
		//		This function is used to implement extend() method of a constructor
		//		produced with declare().
		//
		// example:
		//	|	var A = declare(null, {
		//	|		m1: function(){
		//	|			0 && console.log("A.m1");
		//	|		},
		//	|		m2: function(){
		//	|			0 && console.log("A.m2");
		//	|		}
		//	|	});
		//	|	var B = declare(A, {
		//	|		m1: function(){
		//	|			this.inherited(arguments);
		//	|			0 && console.log("B.m1");
		//	|		}
		//	|	});
		//	|	B.extend({
		//	|		m2: function(){
		//	|			this.inherited(arguments);
		//	|			0 && console.log("B.m2");
		//	|		}
		//	|	});
		//	|	var x = new B();
		//	|	dojo.safeMixin(x, {
		//	|		m1: function(){
		//	|			this.inherited(arguments);
		//	|			0 && console.log("X.m1");
		//	|		},
		//	|		m2: function(){
		//	|			this.inherited(arguments);
		//	|			0 && console.log("X.m2");
		//	|		}
		//	|	});
		//	|	x.m2();
		//	|	// prints:
		//	|	// A.m1
		//	|	// B.m1
		//	|	// X.m1

		var name, t;
		// add props adding metadata for incoming functions skipping a constructor
		for(name in source){
			t = source[name];
			if((t !== op[name] || !(name in op)) && name != cname){
				if(opts.call(t) == "[object Function]"){
					// non-trivial function method => attach its name
					t.nom = name;
				}
				target[name] = t;
			}
		}
		if(has("bug-for-in-skips-shadowed")){
			for(var extraNames= lang._extraNames, i= extraNames.length; i;){
				name = extraNames[--i];
				t = source[name];
				if((t !== op[name] || !(name in op)) && name != cname){
					if(opts.call(t) == "[object Function]"){
						// non-trivial function method => attach its name
						  t.nom = name;
					}
					target[name] = t;
				}
			}
		}
		return target;
	}

	function extend(source){
		declare.safeMixin(this.prototype, source);
		return this;
	}

	function createSubclass(mixins){
		return declare([this].concat(mixins));
	}

	// chained constructor compatible with the legacy declare()
	function chainedConstructor(bases, ctorSpecial){
		return function(){
			var a = arguments, args = a, a0 = a[0], f, i, m,
				l = bases.length, preArgs;

			if(!(this instanceof a.callee)){
				// not called via new, so force it
				return applyNew(a);
			}

			//this._inherited = {};
			// perform the shaman's rituals of the original declare()
			// 1) call two types of the preamble
			if(ctorSpecial && (a0 && a0.preamble || this.preamble)){
				// full blown ritual
				preArgs = new Array(bases.length);
				// prepare parameters
				preArgs[0] = a;
				for(i = 0;;){
					// process the preamble of the 1st argument
					a0 = a[0];
					if(a0){
						f = a0.preamble;
						if(f){
							a = f.apply(this, a) || a;
						}
					}
					// process the preamble of this class
					f = bases[i].prototype;
					f = f.hasOwnProperty("preamble") && f.preamble;
					if(f){
						a = f.apply(this, a) || a;
					}
					// one peculiarity of the preamble:
					// it is called if it is not needed,
					// e.g., there is no constructor to call
					// let's watch for the last constructor
					// (see ticket #9795)
					if(++i == l){
						break;
					}
					preArgs[i] = a;
				}
			}
			// 2) call all non-trivial constructors using prepared arguments
			for(i = l - 1; i >= 0; --i){
				f = bases[i];
				m = f._meta;
				f = m ? m.ctor : f;
				if(f){
					f.apply(this, preArgs ? preArgs[i] : a);
				}
			}
			// 3) continue the original ritual: call the postscript
			f = this.postscript;
			if(f){
				f.apply(this, args);
			}
		};
	}


	// chained constructor compatible with the legacy declare()
	function singleConstructor(ctor, ctorSpecial){
		return function(){
			var a = arguments, t = a, a0 = a[0], f;

			if(!(this instanceof a.callee)){
				// not called via new, so force it
				return applyNew(a);
			}

			//this._inherited = {};
			// perform the shaman's rituals of the original declare()
			// 1) call two types of the preamble
			if(ctorSpecial){
				// full blown ritual
				if(a0){
					// process the preamble of the 1st argument
					f = a0.preamble;
					if(f){
						t = f.apply(this, t) || t;
					}
				}
				f = this.preamble;
				if(f){
					// process the preamble of this class
					f.apply(this, t);
					// one peculiarity of the preamble:
					// it is called even if it is not needed,
					// e.g., there is no constructor to call
					// let's watch for the last constructor
					// (see ticket #9795)
				}
			}
			// 2) call a constructor
			if(ctor){
				ctor.apply(this, a);
			}
			// 3) continue the original ritual: call the postscript
			f = this.postscript;
			if(f){
				f.apply(this, a);
			}
		};
	}

	// plain vanilla constructor (can use inherited() to call its base constructor)
	function simpleConstructor(bases){
		return function(){
			var a = arguments, i = 0, f, m;

			if(!(this instanceof a.callee)){
				// not called via new, so force it
				return applyNew(a);
			}

			//this._inherited = {};
			// perform the shaman's rituals of the original declare()
			// 1) do not call the preamble
			// 2) call the top constructor (it can use this.inherited())
			for(; f = bases[i]; ++i){ // intentional assignment
				m = f._meta;
				f = m ? m.ctor : f;
				if(f){
					f.apply(this, a);
					break;
				}
			}
			// 3) call the postscript
			f = this.postscript;
			if(f){
				f.apply(this, a);
			}
		};
	}

	function chain(name, bases, reversed){
		return function(){
			var b, m, f, i = 0, step = 1;
			if(reversed){
				i = bases.length - 1;
				step = -1;
			}
			for(; b = bases[i]; i += step){ // intentional assignment
				m = b._meta;
				f = (m ? m.hidden : b.prototype)[name];
				if(f){
					f.apply(this, arguments);
				}
			}
		};
	}

	// forceNew(ctor)
	// return a new object that inherits from ctor.prototype but
	// without actually running ctor on the object.
	function forceNew(ctor){
		// create object with correct prototype using a do-nothing
		// constructor
		xtor.prototype = ctor.prototype;
		var t = new xtor;
		xtor.prototype = null;	// clean up
		return t;
	}

	// applyNew(args)
	// just like 'new ctor()' except that the constructor and its arguments come
	// from args, which must be an array or an arguments object
	function applyNew(args){
		// create an object with ctor's prototype but without
		// calling ctor on it.
		var ctor = args.callee, t = forceNew(ctor);
		// execute the real constructor on the new object
		ctor.apply(t, args);
		return t;
	}

	function declare(className, superclass, props){
		// summary:
		//		Create a feature-rich constructor from compact notation.
		// className: String?
		//		The optional name of the constructor (loosely, a "class")
		//		stored in the "declaredClass" property in the created prototype.
		//		It will be used as a global name for a created constructor.
		// superclass: Function|Function[]
		//		May be null, a Function, or an Array of Functions. This argument
		//		specifies a list of bases (the left-most one is the most deepest
		//		base).
		// props: Object
		//		An object whose properties are copied to the created prototype.
		//		Add an instance-initialization function by making it a property
		//		named "constructor".
		// returns: dojo/_base/declare.__DeclareCreatedObject
		//		New constructor function.
		// description:
		//		Create a constructor using a compact notation for inheritance and
		//		prototype extension.
		//
		//		Mixin ancestors provide a type of multiple inheritance.
		//		Prototypes of mixin ancestors are copied to the new class:
		//		changes to mixin prototypes will not affect classes to which
		//		they have been mixed in.
		//
		//		Ancestors can be compound classes created by this version of
		//		declare(). In complex cases all base classes are going to be
		//		linearized according to C3 MRO algorithm
		//		(see http://www.python.org/download/releases/2.3/mro/ for more
		//		details).
		//
		//		"className" is cached in "declaredClass" property of the new class,
		//		if it was supplied. The immediate super class will be cached in
		//		"superclass" property of the new class.
		//
		//		Methods in "props" will be copied and modified: "nom" property
		//		(the declared name of the method) will be added to all copied
		//		functions to help identify them for the internal machinery. Be
		//		very careful, while reusing methods: if you use the same
		//		function under different names, it can produce errors in some
		//		cases.
		//
		//		It is possible to use constructors created "manually" (without
		//		declare()) as bases. They will be called as usual during the
		//		creation of an instance, their methods will be chained, and even
		//		called by "this.inherited()".
		//
		//		Special property "-chains-" governs how to chain methods. It is
		//		a dictionary, which uses method names as keys, and hint strings
		//		as values. If a hint string is "after", this method will be
		//		called after methods of its base classes. If a hint string is
		//		"before", this method will be called before methods of its base
		//		classes.
		//
		//		If "constructor" is not mentioned in "-chains-" property, it will
		//		be chained using the legacy mode: using "after" chaining,
		//		calling preamble() method before each constructor, if available,
		//		and calling postscript() after all constructors were executed.
		//		If the hint is "after", it is chained as a regular method, but
		//		postscript() will be called after the chain of constructors.
		//		"constructor" cannot be chained "before", but it allows
		//		a special hint string: "manual", which means that constructors
		//		are not going to be chained in any way, and programmer will call
		//		them manually using this.inherited(). In the latter case
		//		postscript() will be called after the construction.
		//
		//		All chaining hints are "inherited" from base classes and
		//		potentially can be overridden. Be very careful when overriding
		//		hints! Make sure that all chained methods can work in a proposed
		//		manner of chaining.
		//
		//		Once a method was chained, it is impossible to unchain it. The
		//		only exception is "constructor". You don't need to define a
		//		method in order to supply a chaining hint.
		//
		//		If a method is chained, it cannot use this.inherited() because
		//		all other methods in the hierarchy will be called automatically.
		//
		//		Usually constructors and initializers of any kind are chained
		//		using "after" and destructors of any kind are chained as
		//		"before". Note that chaining assumes that chained methods do not
		//		return any value: any returned value will be discarded.
		//
		// example:
		//	|	declare("my.classes.bar", my.classes.foo, {
		//	|		// properties to be added to the class prototype
		//	|		someValue: 2,
		//	|		// initialization function
		//	|		constructor: function(){
		//	|			this.myComplicatedObject = new ReallyComplicatedObject();
		//	|		},
		//	|		// other functions
		//	|		someMethod: function(){
		//	|			doStuff();
		//	|		}
		//	|	});
		//
		// example:
		//	|	var MyBase = declare(null, {
		//	|		// constructor, properties, and methods go here
		//	|		// ...
		//	|	});
		//	|	var MyClass1 = declare(MyBase, {
		//	|		// constructor, properties, and methods go here
		//	|		// ...
		//	|	});
		//	|	var MyClass2 = declare(MyBase, {
		//	|		// constructor, properties, and methods go here
		//	|		// ...
		//	|	});
		//	|	var MyDiamond = declare([MyClass1, MyClass2], {
		//	|		// constructor, properties, and methods go here
		//	|		// ...
		//	|	});
		//
		// example:
		//	|	var F = function(){ 0 && console.log("raw constructor"); };
		//	|	F.prototype.method = function(){
		//	|		0 && console.log("raw method");
		//	|	};
		//	|	var A = declare(F, {
		//	|		constructor: function(){
		//	|			0 && console.log("A.constructor");
		//	|		},
		//	|		method: function(){
		//	|			0 && console.log("before calling F.method...");
		//	|			this.inherited(arguments);
		//	|			0 && console.log("...back in A");
		//	|		}
		//	|	});
		//	|	new A().method();
		//	|	// will print:
		//	|	// raw constructor
		//	|	// A.constructor
		//	|	// before calling F.method...
		//	|	// raw method
		//	|	// ...back in A
		//
		// example:
		//	|	var A = declare(null, {
		//	|		"-chains-": {
		//	|			destroy: "before"
		//	|		}
		//	|	});
		//	|	var B = declare(A, {
		//	|		constructor: function(){
		//	|			0 && console.log("B.constructor");
		//	|		},
		//	|		destroy: function(){
		//	|			0 && console.log("B.destroy");
		//	|		}
		//	|	});
		//	|	var C = declare(B, {
		//	|		constructor: function(){
		//	|			0 && console.log("C.constructor");
		//	|		},
		//	|		destroy: function(){
		//	|			0 && console.log("C.destroy");
		//	|		}
		//	|	});
		//	|	new C().destroy();
		//	|	// prints:
		//	|	// B.constructor
		//	|	// C.constructor
		//	|	// C.destroy
		//	|	// B.destroy
		//
		// example:
		//	|	var A = declare(null, {
		//	|		"-chains-": {
		//	|			constructor: "manual"
		//	|		}
		//	|	});
		//	|	var B = declare(A, {
		//	|		constructor: function(){
		//	|			// ...
		//	|			// call the base constructor with new parameters
		//	|			this.inherited(arguments, [1, 2, 3]);
		//	|			// ...
		//	|		}
		//	|	});
		//
		// example:
		//	|	var A = declare(null, {
		//	|		"-chains-": {
		//	|			m1: "before"
		//	|		},
		//	|		m1: function(){
		//	|			0 && console.log("A.m1");
		//	|		},
		//	|		m2: function(){
		//	|			0 && console.log("A.m2");
		//	|		}
		//	|	});
		//	|	var B = declare(A, {
		//	|		"-chains-": {
		//	|			m2: "after"
		//	|		},
		//	|		m1: function(){
		//	|			0 && console.log("B.m1");
		//	|		},
		//	|		m2: function(){
		//	|			0 && console.log("B.m2");
		//	|		}
		//	|	});
		//	|	var x = new B();
		//	|	x.m1();
		//	|	// prints:
		//	|	// B.m1
		//	|	// A.m1
		//	|	x.m2();
		//	|	// prints:
		//	|	// A.m2
		//	|	// B.m2

		// crack parameters
		if(typeof className != "string"){
			props = superclass;
			superclass = className;
			className = "";
		}
		props = props || {};

		var proto, i, t, ctor, name, bases, chains, mixins = 1, parents = superclass;

		// build a prototype
		if(opts.call(superclass) == "[object Array]"){
			// C3 MRO
			bases = c3mro(superclass, className);
			t = bases[0];
			mixins = bases.length - t;
			superclass = bases[mixins];
		}else{
			bases = [0];
			if(superclass){
				if(opts.call(superclass) == "[object Function]"){
					t = superclass._meta;
					bases = bases.concat(t ? t.bases : superclass);
				}else{
					err("base class is not a callable constructor.", className);
				}
			}else if(superclass !== null){
				err("unknown base class. Did you use dojo.require to pull it in?", className);
			}
		}
		if(superclass){
			for(i = mixins - 1;; --i){
				proto = forceNew(superclass);
				if(!i){
					// stop if nothing to add (the last base)
					break;
				}
				// mix in properties
				t = bases[i];
				(t._meta ? mixOwn : mix)(proto, t.prototype);
				// chain in new constructor
				ctor = new Function;
				ctor.superclass = superclass;
				ctor.prototype = proto;
				superclass = proto.constructor = ctor;
			}
		}else{
			proto = {};
		}
		// add all properties
		declare.safeMixin(proto, props);
		// add constructor
		t = props.constructor;
		if(t !== op.constructor){
			t.nom = cname;
			proto.constructor = t;
		}

		// collect chains and flags
		for(i = mixins - 1; i; --i){ // intentional assignment
			t = bases[i]._meta;
			if(t && t.chains){
				chains = mix(chains || {}, t.chains);
			}
		}
		if(proto["-chains-"]){
			chains = mix(chains || {}, proto["-chains-"]);
		}

		// build ctor
		t = !chains || !chains.hasOwnProperty(cname);
		bases[0] = ctor = (chains && chains.constructor === "manual") ? simpleConstructor(bases) :
			(bases.length == 1 ? singleConstructor(props.constructor, t) : chainedConstructor(bases, t));

		// add meta information to the constructor
		ctor._meta  = {bases: bases, hidden: props, chains: chains,
			parents: parents, ctor: props.constructor};
		ctor.superclass = superclass && superclass.prototype;
		ctor.extend = extend;
		ctor.createSubclass = createSubclass;
		ctor.prototype = proto;
		proto.constructor = ctor;

		// add "standard" methods to the prototype
		proto.getInherited = getInherited;
		proto.isInstanceOf = isInstanceOf;
		proto.inherited    = inheritedImpl;
		proto.__inherited  = inherited;

		// add name if specified
		if(className){
			proto.declaredClass = className;
			lang.setObject(className, ctor);
		}

		// build chains and add them to the prototype
		if(chains){
			for(name in chains){
				if(proto[name] && typeof chains[name] == "string" && name != cname){
					t = proto[name] = chain(name, bases, chains[name] === "after");
					t.nom = name;
				}
			}
		}
		// chained methods do not return values
		// no need to chain "invisible" functions

		return ctor;	// Function
	}

	/*=====
	declare.__DeclareCreatedObject = {
		// summary:
		//		dojo/_base/declare() returns a constructor `C`.   `new C()` returns an Object with the following
		//		methods, in addition to the methods and properties specified via the arguments passed to declare().

		inherited: function(name, args, newArgs){
			// summary:
			//		Calls a super method.
			// name: String?
			//		The optional method name. Should be the same as the caller's
			//		name. Usually "name" is specified in complex dynamic cases, when
			//		the calling method was dynamically added, undecorated by
			//		declare(), and it cannot be determined.
			// args: Arguments
			//		The caller supply this argument, which should be the original
			//		"arguments".
			// newArgs: Object?
			//		If "true", the found function will be returned without
			//		executing it.
			//		If Array, it will be used to call a super method. Otherwise
			//		"args" will be used.
			// returns:
			//		Whatever is returned by a super method, or a super method itself,
			//		if "true" was specified as newArgs.
			// description:
			//		This method is used inside method of classes produced with
			//		declare() to call a super method (next in the chain). It is
			//		used for manually controlled chaining. Consider using the regular
			//		chaining, because it is faster. Use "this.inherited()" only in
			//		complex cases.
			//
			//		This method cannot me called from automatically chained
			//		constructors including the case of a special (legacy)
			//		constructor chaining. It cannot be called from chained methods.
			//
			//		If "this.inherited()" cannot find the next-in-chain method, it
			//		does nothing and returns "undefined". The last method in chain
			//		can be a default method implemented in Object, which will be
			//		called last.
			//
			//		If "name" is specified, it is assumed that the method that
			//		received "args" is the parent method for this call. It is looked
			//		up in the chain list and if it is found the next-in-chain method
			//		is called. If it is not found, the first-in-chain method is
			//		called.
			//
			//		If "name" is not specified, it will be derived from the calling
			//		method (using a methoid property "nom").
			//
			// example:
			//	|	var B = declare(A, {
			//	|		method1: function(a, b, c){
			//	|			this.inherited(arguments);
			//	|		},
			//	|		method2: function(a, b){
			//	|			return this.inherited(arguments, [a + b]);
			//	|		}
			//	|	});
			//	|	// next method is not in the chain list because it is added
			//	|	// manually after the class was created.
			//	|	B.prototype.method3 = function(){
			//	|		0 && console.log("This is a dynamically-added method.");
			//	|		this.inherited("method3", arguments);
			//	|	};
			// example:
			//	|	var B = declare(A, {
			//	|		method: function(a, b){
			//	|			var super = this.inherited(arguments, true);
			//	|			// ...
			//	|			if(!super){
			//	|				0 && console.log("there is no super method");
			//	|				return 0;
			//	|			}
			//	|			return super.apply(this, arguments);
			//	|		}
			//	|	});
			return	{};	// Object
		},

		getInherited: function(name, args){
			// summary:
			//		Returns a super method.
			// name: String?
			//		The optional method name. Should be the same as the caller's
			//		name. Usually "name" is specified in complex dynamic cases, when
			//		the calling method was dynamically added, undecorated by
			//		declare(), and it cannot be determined.
			// args: Arguments
			//		The caller supply this argument, which should be the original
			//		"arguments".
			// returns:
			//		Returns a super method (Function) or "undefined".
			// description:
			//		This method is a convenience method for "this.inherited()".
			//		It uses the same algorithm but instead of executing a super
			//		method, it returns it, or "undefined" if not found.
			//
			// example:
			//	|	var B = declare(A, {
			//	|		method: function(a, b){
			//	|			var super = this.getInherited(arguments);
			//	|			// ...
			//	|			if(!super){
			//	|				0 && console.log("there is no super method");
			//	|				return 0;
			//	|			}
			//	|			return super.apply(this, arguments);
			//	|		}
			//	|	});
			return	{};	// Object
		},

		isInstanceOf: function(cls){
			// summary:
			//		Checks the inheritance chain to see if it is inherited from this
			//		class.
			// cls: Function
			//		Class constructor.
			// returns:
			//		"true", if this object is inherited from this class, "false"
			//		otherwise.
			// description:
			//		This method is used with instances of classes produced with
			//		declare() to determine of they support a certain interface or
			//		not. It models "instanceof" operator.
			//
			// example:
			//	|	var A = declare(null, {
			//	|		// constructor, properties, and methods go here
			//	|		// ...
			//	|	});
			//	|	var B = declare(null, {
			//	|		// constructor, properties, and methods go here
			//	|		// ...
			//	|	});
			//	|	var C = declare([A, B], {
			//	|		// constructor, properties, and methods go here
			//	|		// ...
			//	|	});
			//	|	var D = declare(A, {
			//	|		// constructor, properties, and methods go here
			//	|		// ...
			//	|	});
			//	|
			//	|	var a = new A(), b = new B(), c = new C(), d = new D();
			//	|
			//	|	0 && console.log(a.isInstanceOf(A)); // true
			//	|	0 && console.log(b.isInstanceOf(A)); // false
			//	|	0 && console.log(c.isInstanceOf(A)); // true
			//	|	0 && console.log(d.isInstanceOf(A)); // true
			//	|
			//	|	0 && console.log(a.isInstanceOf(B)); // false
			//	|	0 && console.log(b.isInstanceOf(B)); // true
			//	|	0 && console.log(c.isInstanceOf(B)); // true
			//	|	0 && console.log(d.isInstanceOf(B)); // false
			//	|
			//	|	0 && console.log(a.isInstanceOf(C)); // false
			//	|	0 && console.log(b.isInstanceOf(C)); // false
			//	|	0 && console.log(c.isInstanceOf(C)); // true
			//	|	0 && console.log(d.isInstanceOf(C)); // false
			//	|
			//	|	0 && console.log(a.isInstanceOf(D)); // false
			//	|	0 && console.log(b.isInstanceOf(D)); // false
			//	|	0 && console.log(c.isInstanceOf(D)); // false
			//	|	0 && console.log(d.isInstanceOf(D)); // true
			return	{};	// Object
		},

		extend: function(source){
			// summary:
			//		Adds all properties and methods of source to constructor's
			//		prototype, making them available to all instances created with
			//		constructor. This method is specific to constructors created with
			//		declare().
			// source: Object
			//		Source object which properties are going to be copied to the
			//		constructor's prototype.
			// description:
			//		Adds source properties to the constructor's prototype. It can
			//		override existing properties.
			//
			//		This method is similar to dojo.extend function, but it is specific
			//		to constructors produced by declare(). It is implemented
			//		using dojo.safeMixin, and it skips a constructor property,
			//		and properly decorates copied functions.
			//
			// example:
			//	|	var A = declare(null, {
			//	|		m1: function(){},
			//	|		s1: "Popokatepetl"
			//	|	});
			//	|	A.extend({
			//	|		m1: function(){},
			//	|		m2: function(){},
			//	|		f1: true,
			//	|		d1: 42
			//	|	});
		}
	};
	=====*/

	// For back-compat, remove for 2.0
	dojo.safeMixin = declare.safeMixin = safeMixin;
	dojo.declare = declare;

	return declare;
});

},
'dojo/dom-class':function(){
define(["./_base/lang", "./_base/array", "./dom"], function(lang, array, dom){
	// module:
	//		dojo/dom-class

	var className = "className";

	/* Part I of classList-based implementation is preserved here for posterity
	var classList = "classList";
	has.add("dom-classList", function(){
		return classList in document.createElement("p");
	});
	*/

	// =============================
	// (CSS) Class Functions
	// =============================

	var cls, // exports object
		spaces = /\s+/, a1 = [""];

	function str2array(s){
		if(typeof s == "string" || s instanceof String){
			if(s && !spaces.test(s)){
				a1[0] = s;
				return a1;
			}
			var a = s.split(spaces);
			if(a.length && !a[0]){
				a.shift();
			}
			if(a.length && !a[a.length - 1]){
				a.pop();
			}
			return a;
		}
		// assumed to be an array
		if(!s){
			return [];
		}
		return array.filter(s, function(x){ return x; });
	}

	/* Part II of classList-based implementation is preserved here for posterity
	if(has("dom-classList")){
		// new classList version
		cls = {
			contains: function containsClass(node, classStr){
				var clslst = classStr && dom.byId(node)[classList];
				return clslst && clslst.contains(classStr); // Boolean
			},

			add: function addClass(node, classStr){
				node = dom.byId(node);
				classStr = str2array(classStr);
				for(var i = 0, len = classStr.length; i < len; ++i){
					node[classList].add(classStr[i]);
				}
			},

			remove: function removeClass(node, classStr){
				node = dom.byId(node);
				if(classStr === undefined){
					node[className] = "";
				}else{
					classStr = str2array(classStr);
					for(var i = 0, len = classStr.length; i < len; ++i){
						node[classList].remove(classStr[i]);
					}
				}
			},

			replace: function replaceClass(node, addClassStr, removeClassStr){
				node = dom.byId(node);
				if(removeClassStr === undefined){
					node[className] = "";
				}else{
					removeClassStr = str2array(removeClassStr);
					for(var i = 0, len = removeClassStr.length; i < len; ++i){
						node[classList].remove(removeClassStr[i]);
					}
				}
				addClassStr = str2array(addClassStr);
				for(i = 0, len = addClassStr.length; i < len; ++i){
					node[classList].add(addClassStr[i]);
				}
			},

			toggle: function toggleClass(node, classStr, condition){
				node = dom.byId(node);
				if(condition === undefined){
					classStr = str2array(classStr);
					for(var i = 0, len = classStr.length; i < len; ++i){
						node[classList].toggle(classStr[i]);
					}
				}else{
					cls[condition ? "add" : "remove"](node, classStr);
				}
				return condition;   // Boolean
			}
		}
	}
	*/

	// regular DOM version
	var fakeNode = {};  // for effective replacement
	cls = {
		// summary:
		//		This module defines the core dojo DOM class API.

		contains: function containsClass(/*DomNode|String*/ node, /*String*/ classStr){
			// summary:
			//		Returns whether or not the specified classes are a portion of the
			//		class list currently applied to the node.
			// node: String|DOMNode
			//		String ID or DomNode reference to check the class for.
			// classStr: String
			//		A string class name to look for.
			// example:
			//		Do something if a node with id="someNode" has class="aSillyClassName" present
			//	|	if(dojo.hasClass("someNode","aSillyClassName")){ ... }

			return ((" " + dom.byId(node)[className] + " ").indexOf(" " + classStr + " ") >= 0); // Boolean
		},

		add: function addClass(/*DomNode|String*/ node, /*String|Array*/ classStr){
			// summary:
			//		Adds the specified classes to the end of the class list on the
			//		passed node. Will not re-apply duplicate classes.
			//
			// node: String|DOMNode
			//		String ID or DomNode reference to add a class string too
			//
			// classStr: String|Array
			//		A String class name to add, or several space-separated class names,
			//		or an array of class names.
			//
			// example:
			//		Add a class to some node:
			//	|	require(["dojo/dom-class"], function(domClass){
			//	|		domClass.add("someNode", "anewClass");
			//	|	});
			//
			// example:
			//		Add two classes at once:
			//	|	require(["dojo/dom-class"], function(domClass){
			//	|		domClass.add("someNode", "firstClass secondClass");
			//	|	});
			//
			// example:
			//		Add two classes at once (using array):
			//	|	require(["dojo/dom-class"], function(domClass){
			//	|		domClass.add("someNode", ["firstClass", "secondClass"]);
			//	|	});
			//
			// example:
			//		Available in `dojo/NodeList` for multiple additions
			//	|	require(["dojo/query"], function(query){
			//	|		query("ul > li").addClass("firstLevel");
			//	|	});

			node = dom.byId(node);
			classStr = str2array(classStr);
			var cls = node[className], oldLen;
			cls = cls ? " " + cls + " " : " ";
			oldLen = cls.length;
			for(var i = 0, len = classStr.length, c; i < len; ++i){
				c = classStr[i];
				if(c && cls.indexOf(" " + c + " ") < 0){
					cls += c + " ";
				}
			}
			if(oldLen < cls.length){
				node[className] = cls.substr(1, cls.length - 2);
			}
		},

		remove: function removeClass(/*DomNode|String*/ node, /*String|Array?*/ classStr){
			// summary:
			//		Removes the specified classes from node. No `contains()`
			//		check is required.
			//
			// node: String|DOMNode
			//		String ID or DomNode reference to remove the class from.
			//
			// classStr: String|Array
			//		An optional String class name to remove, or several space-separated
			//		class names, or an array of class names. If omitted, all class names
			//		will be deleted.
			//
			// example:
			//		Remove a class from some node:
			//	|	require(["dojo/dom-class"], function(domClass){
			//	|		domClass.remove("someNode", "firstClass");
			//	|	});
			//
			// example:
			//		Remove two classes from some node:
			//	|	require(["dojo/dom-class"], function(domClass){
			//	|		domClass.remove("someNode", "firstClass secondClass");
			//	|	});
			//
			// example:
			//		Remove two classes from some node (using array):
			//	|	require(["dojo/dom-class"], function(domClass){
			//	|		domClass.remove("someNode", ["firstClass", "secondClass"]);
			//	|	});
			//
			// example:
			//		Remove all classes from some node:
			//	|	require(["dojo/dom-class"], function(domClass){
			//	|		domClass.remove("someNode");
			//	|	});
			//
			// example:
			//		Available in `dojo/NodeList` for multiple removal
			//	|	require(["dojo/query"], function(query){
			//	|		query("ul > li").removeClass("foo");
			//	|	});

			node = dom.byId(node);
			var cls;
			if(classStr !== undefined){
				classStr = str2array(classStr);
				cls = " " + node[className] + " ";
				for(var i = 0, len = classStr.length; i < len; ++i){
					cls = cls.replace(" " + classStr[i] + " ", " ");
				}
				cls = lang.trim(cls);
			}else{
				cls = "";
			}
			if(node[className] != cls){ node[className] = cls; }
		},

		replace: function replaceClass(/*DomNode|String*/ node, /*String|Array*/ addClassStr, /*String|Array?*/ removeClassStr){
			// summary:
			//		Replaces one or more classes on a node if not present.
			//		Operates more quickly than calling dojo.removeClass and dojo.addClass
			//
			// node: String|DOMNode
			//		String ID or DomNode reference to remove the class from.
			//
			// addClassStr: String|Array
			//		A String class name to add, or several space-separated class names,
			//		or an array of class names.
			//
			// removeClassStr: String|Array?
			//		A String class name to remove, or several space-separated class names,
			//		or an array of class names.
			//
			// example:
			//	|	require(["dojo/dom-class"], function(domClass){
			//	|		domClass.replace("someNode", "add1 add2", "remove1 remove2");
			//	|	});
			//
			// example:
			//	Replace all classes with addMe
			//	|	require(["dojo/dom-class"], function(domClass){
			//	|		domClass.replace("someNode", "addMe");
			//	|	});
			//
			// example:
			//	Available in `dojo/NodeList` for multiple toggles
			//	|	require(["dojo/query"], function(query){
			//	|		query(".findMe").replaceClass("addMe", "removeMe");
			//	|	});

			node = dom.byId(node);
			fakeNode[className] = node[className];
			cls.remove(fakeNode, removeClassStr);
			cls.add(fakeNode, addClassStr);
			if(node[className] !== fakeNode[className]){
				node[className] = fakeNode[className];
			}
		},

		toggle: function toggleClass(/*DomNode|String*/ node, /*String|Array*/ classStr, /*Boolean?*/ condition){
			// summary:
			//		Adds a class to node if not present, or removes if present.
			//		Pass a boolean condition if you want to explicitly add or remove.
			//		Returns the condition that was specified directly or indirectly.
			//
			// node: String|DOMNode
			//		String ID or DomNode reference to toggle a class string
			//
			// classStr: String|Array
			//		A String class name to toggle, or several space-separated class names,
			//		or an array of class names.
			//
			// condition:
			//		If passed, true means to add the class, false means to remove.
			//		Otherwise dojo.hasClass(node, classStr) is used to detect the class presence.
			//
			// example:
			//	|	require(["dojo/dom-class"], function(domClass){
			//	|		domClass.toggle("someNode", "hovered");
			//	|	});
			//
			// example:
			//		Forcefully add a class
			//	|	require(["dojo/dom-class"], function(domClass){
			//	|		domClass.toggle("someNode", "hovered", true);
			//	|	});
			//
			// example:
			//		Available in `dojo/NodeList` for multiple toggles
			//	|	require(["dojo/query"], function(query){
			//	|		query(".toggleMe").toggleClass("toggleMe");
			//	|	});

			node = dom.byId(node);
			if(condition === undefined){
				classStr = str2array(classStr);
				for(var i = 0, len = classStr.length, c; i < len; ++i){
					c = classStr[i];
					cls[cls.contains(node, c) ? "remove" : "add"](node, c);
				}
			}else{
				cls[condition ? "add" : "remove"](node, classStr);
			}
			return condition;   // Boolean
		}
	};

	return cls;
});

},
'dojo/dom-construct':function(){
define(["exports", "./_base/kernel", "./sniff", "./_base/window", "./dom", "./dom-attr", "./on"],
		function(exports, dojo, has, win, dom, attr, on){
	// module:
	//		dojo/dom-construct
	// summary:
	//		This module defines the core dojo DOM construction API.

	// TODOC: summary not showing up in output, see https://github.com/csnover/js-doc-parse/issues/42

	// support stuff for toDom()
	var tagWrap = {
			option: ["select"],
			tbody: ["table"],
			thead: ["table"],
			tfoot: ["table"],
			tr: ["table", "tbody"],
			td: ["table", "tbody", "tr"],
			th: ["table", "thead", "tr"],
			legend: ["fieldset"],
			caption: ["table"],
			colgroup: ["table"],
			col: ["table", "colgroup"],
			li: ["ul"]
		},
		reTag = /<\s*([\w\:]+)/,
		masterNode = {}, masterNum = 0,
		masterName = "__" + dojo._scopeName + "ToDomId";

	// generate start/end tag strings to use
	// for the injection for each special tag wrap case.
	for(var param in tagWrap){
		if(tagWrap.hasOwnProperty(param)){
			var tw = tagWrap[param];
			tw.pre = param == "option" ? '<select multiple="multiple">' : "<" + tw.join("><") + ">";
			tw.post = "</" + tw.reverse().join("></") + ">";
			// the last line is destructive: it reverses the array,
			// but we don't care at this point
		}
	}

	function _insertBefore(/*DomNode*/ node, /*DomNode*/ ref){
		var parent = ref.parentNode;
		if(parent){
			parent.insertBefore(node, ref);
		}
	}

	function _insertAfter(/*DomNode*/ node, /*DomNode*/ ref){
		// summary:
		//		Try to insert node after ref
		var parent = ref.parentNode;
		if(parent){
			if(parent.lastChild == ref){
				parent.appendChild(node);
			}else{
				parent.insertBefore(node, ref.nextSibling);
			}
		}
	}

	exports.toDom = function toDom(frag, doc){
		// summary:
		//		instantiates an HTML fragment returning the corresponding DOM.
		// frag: String
		//		the HTML fragment
		// doc: DocumentNode?
		//		optional document to use when creating DOM nodes, defaults to
		//		dojo.doc if not specified.
		// returns:
		//		Document fragment, unless it's a single node in which case it returns the node itself
		// example:
		//		Create a table row:
		//	|	var tr = dojo.toDom("<tr><td>First!</td></tr>");

		doc = doc || win.doc;
		var masterId = doc[masterName];
		if(!masterId){
			doc[masterName] = masterId = ++masterNum + "";
			masterNode[masterId] = doc.createElement("div");
		}

		// make sure the frag is a string.
		frag += "";

		// find the starting tag, and get node wrapper
		var match = frag.match(reTag),
			tag = match ? match[1].toLowerCase() : "",
			master = masterNode[masterId],
			wrap, i, fc, df;
		if(match && tagWrap[tag]){
			wrap = tagWrap[tag];
			master.innerHTML = wrap.pre + frag + wrap.post;
			for(i = wrap.length; i; --i){
				master = master.firstChild;
			}
		}else{
			master.innerHTML = frag;
		}

		// one node shortcut => return the node itself
		if(master.childNodes.length == 1){
			return master.removeChild(master.firstChild); // DOMNode
		}

		// return multiple nodes as a document fragment
		df = doc.createDocumentFragment();
		while((fc = master.firstChild)){ // intentional assignment
			df.appendChild(fc);
		}
		return df; // DocumentFragment
	};

	exports.place = function place(/*DOMNode|String*/ node, /*DOMNode|String*/ refNode, /*String|Number?*/ position){
		// summary:
		//		Attempt to insert node into the DOM, choosing from various positioning options.
		//		Returns the first argument resolved to a DOM node.
		// node: DOMNode|String
		//		id or node reference, or HTML fragment starting with "<" to place relative to refNode
		// refNode: DOMNode|String
		//		id or node reference to use as basis for placement
		// position: String|Number?
		//		string noting the position of node relative to refNode or a
		//		number indicating the location in the childNodes collection of refNode.
		//		Accepted string values are:
		//
		//		- before
		//		- after
		//		- replace
		//		- only
		//		- first
		//		- last
		//
		//		"first" and "last" indicate positions as children of refNode, "replace" replaces refNode,
		//		"only" replaces all children.  position defaults to "last" if not specified
		// returns: DOMNode
		//		Returned values is the first argument resolved to a DOM node.
		//
		//		.place() is also a method of `dojo/NodeList`, allowing `dojo.query` node lookups.
		// example:
		//		Place a node by string id as the last child of another node by string id:
		//	|	dojo.place("someNode", "anotherNode");
		// example:
		//		Place a node by string id before another node by string id
		//	|	dojo.place("someNode", "anotherNode", "before");
		// example:
		//		Create a Node, and place it in the body element (last child):
		//	|	dojo.place("<div></div>", dojo.body());
		// example:
		//		Put a new LI as the first child of a list by id:
		//	|	dojo.place("<li></li>", "someUl", "first");

		refNode = dom.byId(refNode);
		if(typeof node == "string"){ // inline'd type check
			node = /^\s*</.test(node) ? exports.toDom(node, refNode.ownerDocument) : dom.byId(node);
		}
		if(typeof position == "number"){ // inline'd type check
			var cn = refNode.childNodes;
			if(!cn.length || cn.length <= position){
				refNode.appendChild(node);
			}else{
				_insertBefore(node, cn[position < 0 ? 0 : position]);
			}
		}else{
			switch(position){
				case "before":
					_insertBefore(node, refNode);
					break;
				case "after":
					_insertAfter(node, refNode);
					break;
				case "replace":
					refNode.parentNode.replaceChild(node, refNode);
					break;
				case "only":
					exports.empty(refNode);
					refNode.appendChild(node);
					break;
				case "first":
					if(refNode.firstChild){
						_insertBefore(node, refNode.firstChild);
						break;
					}
					// else fallthrough...
				default: // aka: last
					refNode.appendChild(node);
			}
		}
		return node; // DomNode
	};

	exports.create = function create(/*DOMNode|String*/ tag, /*Object*/ attrs, /*DOMNode|String?*/ refNode, /*String?*/ pos){
		// summary:
		//		Create an element, allowing for optional attribute decoration
		//		and placement.
		// description:
		//		A DOM Element creation function. A shorthand method for creating a node or
		//		a fragment, and allowing for a convenient optional attribute setting step,
		//		as well as an optional DOM placement reference.
		//
		//		Attributes are set by passing the optional object through `dojo.setAttr`.
		//		See `dojo.setAttr` for noted caveats and nuances, and API if applicable.
		//
		//		Placement is done via `dojo.place`, assuming the new node to be the action
		//		node, passing along the optional reference node and position.
		// tag: DOMNode|String
		//		A string of the element to create (eg: "div", "a", "p", "li", "script", "br"),
		//		or an existing DOM node to process.
		// attrs: Object
		//		An object-hash of attributes to set on the newly created node.
		//		Can be null, if you don't want to set any attributes/styles.
		//		See: `dojo.setAttr` for a description of available attributes.
		// refNode: DOMNode|String?
		//		Optional reference node. Used by `dojo.place` to place the newly created
		//		node somewhere in the dom relative to refNode. Can be a DomNode reference
		//		or String ID of a node.
		// pos: String?
		//		Optional positional reference. Defaults to "last" by way of `dojo.place`,
		//		though can be set to "first","after","before","last", "replace" or "only"
		//		to further control the placement of the new node relative to the refNode.
		//		'refNode' is required if a 'pos' is specified.
		// example:
		//		Create a DIV:
		//	|	var n = dojo.create("div");
		//
		// example:
		//		Create a DIV with content:
		//	|	var n = dojo.create("div", { innerHTML:"<p>hi</p>" });
		//
		// example:
		//		Place a new DIV in the BODY, with no attributes set
		//	|	var n = dojo.create("div", null, dojo.body());
		//
		// example:
		//		Create an UL, and populate it with LI's. Place the list as the first-child of a
		//		node with id="someId":
		//	|	var ul = dojo.create("ul", null, "someId", "first");
		//	|	var items = ["one", "two", "three", "four"];
		//	|	dojo.forEach(items, function(data){
		//	|		dojo.create("li", { innerHTML: data }, ul);
		//	|	});
		//
		// example:
		//		Create an anchor, with an href. Place in BODY:
		//	|	dojo.create("a", { href:"foo.html", title:"Goto FOO!" }, dojo.body());
		//
		// example:
		//		Create a `dojo/NodeList()` from a new element (for syntactic sugar):
		//	|	dojo.query(dojo.create('div'))
		//	|		.addClass("newDiv")
		//	|		.onclick(function(e){ 0 && console.log('clicked', e.target) })
		//	|		.place("#someNode"); // redundant, but cleaner.

		var doc = win.doc;
		if(refNode){
			refNode = dom.byId(refNode);
			doc = refNode.ownerDocument;
		}
		if(typeof tag == "string"){ // inline'd type check
			tag = doc.createElement(tag);
		}
		if(attrs){ attr.set(tag, attrs); }
		if(refNode){ exports.place(tag, refNode, pos); }
		return tag; // DomNode
	};

	var _empty = has("ie") ?
		function(/*DomNode*/ node){
			try{
				node.innerHTML = ""; // really fast when it works
			}catch(e){ // IE can generate Unknown Error
				for(var c; c = node.lastChild;){ // intentional assignment
					_destroy(c, node); // destroy is better than removeChild so TABLE elements are removed in proper order
				}
			}
		} :
		function(/*DomNode*/ node){
			node.innerHTML = "";
		};

	exports.empty = function empty(/*DOMNode|String*/ node){
		 // summary:
		 //		safely removes all children of the node.
		 // node: DOMNode|String
		 //		a reference to a DOM node or an id.
		 // example:
		 //		Destroy node's children byId:
		 //	|	dojo.empty("someId");
		 //
		 // example:
		 //		Destroy all nodes' children in a list by reference:
		 //	|	dojo.query(".someNode").forEach(dojo.empty);

		_empty(dom.byId(node));
	};


	function _destroy(/*DomNode*/ node, /*DomNode*/ parent){
		if(node.firstChild){
			_empty(node);
		}
		if(parent){
			parent.removeChild(node);
		}
	}
	exports.destroy = function destroy(/*DOMNode|String*/ node){
		// summary:
		//		Removes a node from its parent, clobbering it and all of its
		//		children.
		//
		// description:
		//		Removes a node from its parent, clobbering it and all of its
		//		children. Function only works with DomNodes, and returns nothing.
		//
		// node: DOMNode|String
		//		A String ID or DomNode reference of the element to be destroyed
		//
		// example:
		//		Destroy a node byId:
		//	|	dojo.destroy("someId");
		//
		// example:
		//		Destroy all nodes in a list by reference:
		//	|	dojo.query(".someNode").forEach(dojo.destroy);

		node = dom.byId(node);
		if(!node){ return; }
		_destroy(node, node.parentNode);
	};
});

},
'dojo/dom-attr':function(){
define(["exports", "./sniff", "./_base/lang", "./dom", "./dom-style", "./dom-prop"],
		function(exports, has, lang, dom, style, prop){
	// module:
	//		dojo/dom-attr
	// summary:
	//		This module defines the core dojo DOM attributes API.

	// TODOC: summary not showing up in output see https://github.com/csnover/js-doc-parse/issues/42

	// =============================
	// Element attribute Functions
	// =============================

	// This module will be obsolete soon. Use dojo/prop instead.

	// dojo.attr() should conform to http://www.w3.org/TR/DOM-Level-2-Core/

	// attribute-related functions (to be obsolete soon)

	var forcePropNames = {
			innerHTML:	1,
			className:	1,
			htmlFor:	has("ie"),
			value:		1
		},
		attrNames = {
			// original attribute names
			classname: "class",
			htmlfor: "for",
			// for IE
			tabindex: "tabIndex",
			readonly: "readOnly"
		};

	function _hasAttr(node, name){
		var attr = node.getAttributeNode && node.getAttributeNode(name);
		return attr && attr.specified; // Boolean
	}

	// There is a difference in the presence of certain properties and their default values
	// between browsers. For example, on IE "disabled" is present on all elements,
	// but it is value is "false"; "tabIndex" of <div> returns 0 by default on IE, yet other browsers
	// can return -1.

	exports.has = function hasAttr(/*DOMNode|String*/ node, /*String*/ name){
		// summary:
		//		Returns true if the requested attribute is specified on the
		//		given element, and false otherwise.
		// node: DOMNode|String
		//		id or reference to the element to check
		// name: String
		//		the name of the attribute
		// returns: Boolean
		//		true if the requested attribute is specified on the
		//		given element, and false otherwise

		var lc = name.toLowerCase();
		return forcePropNames[prop.names[lc] || name] || _hasAttr(dom.byId(node), attrNames[lc] || name);	// Boolean
	};

	exports.get = function getAttr(/*DOMNode|String*/ node, /*String*/ name){
		// summary:
		//		Gets an attribute on an HTML element.
		// description:
		//		Handles normalized getting of attributes on DOM Nodes.
		// node: DOMNode|String
		//		id or reference to the element to get the attribute on
		// name: String
		//		the name of the attribute to get.
		// returns:
		//		the value of the requested attribute or null if that attribute does not have a specified or
		//		default value;
		//
		// example:
		//	|	// get the current value of the "foo" attribute on a node
		//	|	dojo.getAttr(dojo.byId("nodeId"), "foo");
		//	|	// or we can just pass the id:
		//	|	dojo.getAttr("nodeId", "foo");

		node = dom.byId(node);
		var lc = name.toLowerCase(),
			propName = prop.names[lc] || name,
			forceProp = forcePropNames[propName],
			value = node[propName];		// should we access this attribute via a property or via getAttribute()?

		if(forceProp && typeof value != "undefined"){
			// node's property
			return value;	// Anything
		}
		if(propName != "href" && (typeof value == "boolean" || lang.isFunction(value))){
			// node's property
			return value;	// Anything
		}
		// node's attribute
		// we need _hasAttr() here to guard against IE returning a default value
		var attrName = attrNames[lc] || name;
		return _hasAttr(node, attrName) ? node.getAttribute(attrName) : null; // Anything
	};

	exports.set = function setAttr(/*DOMNode|String*/ node, /*String|Object*/ name, /*String?*/ value){
		// summary:
		//		Sets an attribute on an HTML element.
		// description:
		//		Handles normalized setting of attributes on DOM Nodes.
		//
		//		When passing functions as values, note that they will not be
		//		directly assigned to slots on the node, but rather the default
		//		behavior will be removed and the new behavior will be added
		//		using `dojo.connect()`, meaning that event handler properties
		//		will be normalized and that some caveats with regards to
		//		non-standard behaviors for onsubmit apply. Namely that you
		//		should cancel form submission using `dojo.stopEvent()` on the
		//		passed event object instead of returning a boolean value from
		//		the handler itself.
		// node: DOMNode|String
		//		id or reference to the element to set the attribute on
		// name: String|Object
		//		the name of the attribute to set, or a hash of key-value pairs to set.
		// value: String?
		//		the value to set for the attribute, if the name is a string.
		// returns:
		//		the DOM node
		//
		// example:
		//	|	// use attr() to set the tab index
		//	|	dojo.setAttr("nodeId", "tabIndex", 3);
		//
		// example:
		//	Set multiple values at once, including event handlers:
		//	|	dojo.setAttr("formId", {
		//	|		"foo": "bar",
		//	|		"tabIndex": -1,
		//	|		"method": "POST",
		//	|		"onsubmit": function(e){
		//	|			// stop submitting the form. Note that the IE behavior
		//	|			// of returning true or false will have no effect here
		//	|			// since our handler is connect()ed to the built-in
		//	|			// onsubmit behavior and so we need to use
		//	|			// dojo.stopEvent() to ensure that the submission
		//	|			// doesn't proceed.
		//	|			dojo.stopEvent(e);
		//	|
		//	|			// submit the form with Ajax
		//	|			dojo.xhrPost({ form: "formId" });
		//	|		}
		//	|	});
		//
		// example:
		//	Style is s special case: Only set with an object hash of styles
		//	|	dojo.setAttr("someNode",{
		//	|		id:"bar",
		//	|		style:{
		//	|			width:"200px", height:"100px", color:"#000"
		//	|		}
		//	|	});
		//
		// example:
		//	Again, only set style as an object hash of styles:
		//	|	var obj = { color:"#fff", backgroundColor:"#000" };
		//	|	dojo.setAttr("someNode", "style", obj);
		//	|
		//	|	// though shorter to use `dojo.style()` in this case:
		//	|	dojo.setStyle("someNode", obj);

		node = dom.byId(node);
		if(arguments.length == 2){ // inline'd type check
			// the object form of setter: the 2nd argument is a dictionary
			for(var x in name){
				exports.set(node, x, name[x]);
			}
			return node; // DomNode
		}
		var lc = name.toLowerCase(),
			propName = prop.names[lc] || name,
			forceProp = forcePropNames[propName];
		if(propName == "style" && typeof value != "string"){ // inline'd type check
			// special case: setting a style
			style.set(node, value);
			return node; // DomNode
		}
		if(forceProp || typeof value == "boolean" || lang.isFunction(value)){
			return prop.set(node, name, value);
		}
		// node's attribute
		node.setAttribute(attrNames[lc] || name, value);
		return node; // DomNode
	};

	exports.remove = function removeAttr(/*DOMNode|String*/ node, /*String*/ name){
		// summary:
		//		Removes an attribute from an HTML element.
		// node: DOMNode|String
		//		id or reference to the element to remove the attribute from
		// name: String
		//		the name of the attribute to remove

		dom.byId(node).removeAttribute(attrNames[name.toLowerCase()] || name);
	};

	exports.getNodeProp = function getNodeProp(/*DomNode|String*/ node, /*String*/ name){
		// summary:
		//		Returns an effective value of a property or an attribute.
		// node: DOMNode|String
		//		id or reference to the element to remove the attribute from
		// name: String
		//		the name of the attribute
		// returns:
		//		the value of the attribute

		node = dom.byId(node);
		var lc = name.toLowerCase(), propName = prop.names[lc] || name;
		if((propName in node) && propName != "href"){
			// node's property
			return node[propName];	// Anything
		}
		// node's attribute
		var attrName = attrNames[lc] || name;
		return _hasAttr(node, attrName) ? node.getAttribute(attrName) : null; // Anything
	};
});

},
'dojo/dom-prop':function(){
define(["exports", "./_base/kernel", "./sniff", "./_base/lang", "./dom", "./dom-style", "./dom-construct", "./_base/connect"],
		function(exports, dojo, has, lang, dom, style, ctr, conn){
	// module:
	//		dojo/dom-prop
	// summary:
	//		This module defines the core dojo DOM properties API.
	//		Indirectly depends on dojo.empty() and dojo.toDom().

	// TODOC: summary not showing up in output, see https://github.com/csnover/js-doc-parse/issues/42

	// =============================
	// Element properties Functions
	// =============================

	// helper to connect events
	var _evtHdlrMap = {}, _ctr = 0, _attrId = dojo._scopeName + "attrid";

	exports.names = {
		// properties renamed to avoid clashes with reserved words
		"class": "className",
		"for": "htmlFor",
		// properties written as camelCase
		tabindex: "tabIndex",
		readonly: "readOnly",
		colspan: "colSpan",
		frameborder: "frameBorder",
		rowspan: "rowSpan",
		valuetype: "valueType"
	};

	exports.get = function getProp(/*DOMNode|String*/ node, /*String*/ name){
		// summary:
		//		Gets a property on an HTML element.
		// description:
		//		Handles normalized getting of properties on DOM nodes.
		//
		// node: DOMNode|String
		//		id or reference to the element to get the property on
		// name: String
		//		the name of the property to get.
		// returns:
		//		the value of the requested property or its default value
		//
		// example:
		//	|	// get the current value of the "foo" property on a node
		//	|	dojo.getProp(dojo.byId("nodeId"), "foo");
		//	|	// or we can just pass the id:
		//	|	dojo.getProp("nodeId", "foo");

		node = dom.byId(node);
		var lc = name.toLowerCase(), propName = exports.names[lc] || name;
		return node[propName];	// Anything
	};

	exports.set = function setProp(/*DOMNode|String*/ node, /*String|Object*/ name, /*String?*/ value){
		// summary:
		//		Sets a property on an HTML element.
		// description:
		//		Handles normalized setting of properties on DOM nodes.
		//
		//		When passing functions as values, note that they will not be
		//		directly assigned to slots on the node, but rather the default
		//		behavior will be removed and the new behavior will be added
		//		using `dojo.connect()`, meaning that event handler properties
		//		will be normalized and that some caveats with regards to
		//		non-standard behaviors for onsubmit apply. Namely that you
		//		should cancel form submission using `dojo.stopEvent()` on the
		//		passed event object instead of returning a boolean value from
		//		the handler itself.
		// node: DOMNode|String
		//		id or reference to the element to set the property on
		// name: String|Object
		//		the name of the property to set, or a hash object to set
		//		multiple properties at once.
		// value: String?
		//		The value to set for the property
		// returns:
		//		the DOM node
		//
		// example:
		//	|	// use prop() to set the tab index
		//	|	dojo.setProp("nodeId", "tabIndex", 3);
		//	|
		//
		// example:
		//	Set multiple values at once, including event handlers:
		//	|	dojo.setProp("formId", {
		//	|		"foo": "bar",
		//	|		"tabIndex": -1,
		//	|		"method": "POST",
		//	|		"onsubmit": function(e){
		//	|			// stop submitting the form. Note that the IE behavior
		//	|			// of returning true or false will have no effect here
		//	|			// since our handler is connect()ed to the built-in
		//	|			// onsubmit behavior and so we need to use
		//	|			// dojo.stopEvent() to ensure that the submission
		//	|			// doesn't proceed.
		//	|			dojo.stopEvent(e);
		//	|
		//	|			// submit the form with Ajax
		//	|			dojo.xhrPost({ form: "formId" });
		//	|		}
		//	|	});
		//
		// example:
		//	Style is s special case: Only set with an object hash of styles
		//	|	dojo.setProp("someNode",{
		//	|		id:"bar",
		//	|		style:{
		//	|			width:"200px", height:"100px", color:"#000"
		//	|		}
		//	|	});
		//
		// example:
		//	Again, only set style as an object hash of styles:
		//	|	var obj = { color:"#fff", backgroundColor:"#000" };
		//	|	dojo.setProp("someNode", "style", obj);
		//	|
		//	|	// though shorter to use `dojo.style()` in this case:
		//	|	dojo.style("someNode", obj);

		node = dom.byId(node);
		var l = arguments.length;
		if(l == 2 && typeof name != "string"){ // inline'd type check
			// the object form of setter: the 2nd argument is a dictionary
			for(var x in name){
				exports.set(node, x, name[x]);
			}
			return node; // DomNode
		}
		var lc = name.toLowerCase(), propName = exports.names[lc] || name;
		if(propName == "style" && typeof value != "string"){ // inline'd type check
			// special case: setting a style
			style.set(node, value);
			return node; // DomNode
		}
		if(propName == "innerHTML"){
			// special case: assigning HTML
			// the hash lists elements with read-only innerHTML on IE
			if(has("ie") && node.tagName.toLowerCase() in {col: 1, colgroup: 1,
						table: 1, tbody: 1, tfoot: 1, thead: 1, tr: 1, title: 1}){
				ctr.empty(node);
				node.appendChild(ctr.toDom(value, node.ownerDocument));
			}else{
				node[propName] = value;
			}
			return node; // DomNode
		}
		if(lang.isFunction(value)){
			// special case: assigning an event handler
			// clobber if we can
			var attrId = node[_attrId];
			if(!attrId){
				attrId = _ctr++;
				node[_attrId] = attrId;
			}
			if(!_evtHdlrMap[attrId]){
				_evtHdlrMap[attrId] = {};
			}
			var h = _evtHdlrMap[attrId][propName];
			if(h){
				//h.remove();
				conn.disconnect(h);
			}else{
				try{
					delete node[propName];
				}catch(e){}
			}
			// ensure that event objects are normalized, etc.
			if(value){
				//_evtHdlrMap[attrId][propName] = on(node, propName, value);
				_evtHdlrMap[attrId][propName] = conn.connect(node, propName, value);
			}else{
				node[propName] = null;
			}
			return node; // DomNode
		}
		node[propName] = value;
		return node;	// DomNode
	};
});

},
'dijit/registry':function(){
define([
	"dojo/_base/array", // array.forEach array.map
	"dojo/sniff", // has("ie")
	"dojo/_base/unload", // unload.addOnWindowUnload
	"dojo/_base/window", // win.body
	"./main"	// dijit._scopeName
], function(array, has, unload, win, dijit){

	// module:
	//		dijit/registry

	var _widgetTypeCtr = {}, hash = {};

	var registry =  {
		// summary:
		//		Registry of existing widget on page, plus some utility methods.

		// length: Number
		//		Number of registered widgets
		length: 0,

		add: function(widget){
			// summary:
			//		Add a widget to the registry. If a duplicate ID is detected, a error is thrown.
			// widget: dijit/_WidgetBase
			//		Any dijit/_WidgetBase subclass.
			if(hash[widget.id]){
				throw new Error("Tried to register widget with id==" + widget.id + " but that id is already registered");
			}
			hash[widget.id] = widget;
			this.length++;
		},

		remove: function(/*String*/ id){
			// summary:
			//		Remove a widget from the registry. Does not destroy the widget; simply
			//		removes the reference.
			if(hash[id]){
				delete hash[id];
				this.length--;
			}
		},

		byId: function(/*String|Widget*/ id){
			// summary:
			//		Find a widget by it's id.
			//		If passed a widget then just returns the widget.
			return typeof id == "string" ? hash[id] : id;	// dijit/_WidgetBase
		},

		byNode: function(/*DOMNode*/ node){
			// summary:
			//		Returns the widget corresponding to the given DOMNode
			return hash[node.getAttribute("widgetId")]; // dijit/_WidgetBase
		},

		toArray: function(){
			// summary:
			//		Convert registry into a true Array
			//
			// example:
			//		Work with the widget .domNodes in a real Array
			//		|	array.map(registry.toArray(), function(w){ return w.domNode; });

			var ar = [];
			for(var id in hash){
				ar.push(hash[id]);
			}
			return ar;	// dijit/_WidgetBase[]
		},

		getUniqueId: function(/*String*/widgetType){
			// summary:
			//		Generates a unique id for a given widgetType

			var id;
			do{
				id = widgetType + "_" +
					(widgetType in _widgetTypeCtr ?
						++_widgetTypeCtr[widgetType] : _widgetTypeCtr[widgetType] = 0);
			}while(hash[id]);
			return dijit._scopeName == "dijit" ? id : dijit._scopeName + "_" + id; // String
		},

		findWidgets: function(root, skipNode){
			// summary:
			//		Search subtree under root returning widgets found.
			//		Doesn't search for nested widgets (ie, widgets inside other widgets).
			// root: DOMNode
			//		Node to search under.
			// skipNode: DOMNode
			//		If specified, don't search beneath this node (usually containerNode).

			var outAry = [];

			function getChildrenHelper(root){
				for(var node = root.firstChild; node; node = node.nextSibling){
					if(node.nodeType == 1){
						var widgetId = node.getAttribute("widgetId");
						if(widgetId){
							var widget = hash[widgetId];
							if(widget){	// may be null on page w/multiple dojo's loaded
								outAry.push(widget);
							}
						}else if(node !== skipNode){
							getChildrenHelper(node);
						}
					}
				}
			}

			getChildrenHelper(root);
			return outAry;
		},

		_destroyAll: function(){
			// summary:
			//		Code to destroy all widgets and do other cleanup on page unload

			// Clean up focus manager lingering references to widgets and nodes
			dijit._curFocus = null;
			dijit._prevFocus = null;
			dijit._activeStack = [];

			// Destroy all the widgets, top down
			array.forEach(registry.findWidgets(win.body()), function(widget){
				// Avoid double destroy of widgets like Menu that are attached to <body>
				// even though they are logically children of other widgets.
				if(!widget._destroyed){
					if(widget.destroyRecursive){
						widget.destroyRecursive();
					}else if(widget.destroy){
						widget.destroy();
					}
				}
			});
		},

		getEnclosingWidget: function(/*DOMNode*/ node){
			// summary:
			//		Returns the widget whose DOM tree contains the specified DOMNode, or null if
			//		the node is not contained within the DOM tree of any widget
			while(node){
				var id = node.nodeType == 1 && node.getAttribute("widgetId");
				if(id){
					return hash[id];
				}
				node = node.parentNode;
			}
			return null;
		},

		// In case someone needs to access hash.
		// Actually, this is accessed from WidgetSet back-compatibility code
		_hash: hash
	};

	dijit.registry = registry;

	return registry;
});

},
'dojo/_base/unload':function(){
define(["./kernel", "./lang", "../on"], function(dojo, lang, on){

// module:
//		dojo/unload

var win = window;

var unload = {
	// summary:
	//		This module contains the document and window unload detection API.

	addOnWindowUnload: function(/*Object|Function?*/ obj, /*String|Function?*/ functionName){
		// summary:
		//		registers a function to be triggered when window.onunload
		//		fires.
		// description:
		//		The first time that addOnWindowUnload is called Dojo
		//		will register a page listener to trigger your unload
		//		handler with. Note that registering these handlers may
		//		destroy "fastback" page caching in browsers that support
		//		it. Be careful trying to modify the DOM or access
		//		JavaScript properties during this phase of page unloading:
		//		they may not always be available. Consider
		//		addOnUnload() if you need to modify the DOM or do
		//		heavy JavaScript work since it fires at the equivalent of
		//		the page's "onbeforeunload" event.
		// example:
		//	|	unload.addOnWindowUnload(functionPointer)
		//	|	unload.addOnWindowUnload(object, "functionName");
		//	|	unload.addOnWindowUnload(object, function(){ /* ... */});

		if (!dojo.windowUnloaded){
			on(win, "unload", (dojo.windowUnloaded = function(){
				// summary:
				//		signal fired by impending window destruction. You may use
				//		dojo.addOnWindowUnload() to register a listener for this
				//		event. NOTE: if you wish to dojo.connect() to this method
				//		to perform page/application cleanup, be aware that this
				//		event WILL NOT fire if no handler has been registered with
				//		addOnWindowUnload(). This behavior started in Dojo 1.3.
				//		Previous versions always triggered windowUnloaded(). See
				//		addOnWindowUnload for more info.
			}));
		}
		on(win, "unload", lang.hitch(obj, functionName));
	},

	addOnUnload: function(/*Object?|Function?*/ obj, /*String|Function?*/ functionName){
		// summary:
		//		registers a function to be triggered when the page unloads.
		// description:
		//		The first time that addOnUnload is called Dojo will
		//		register a page listener to trigger your unload handler
		//		with.
		//
		//		In a browser environment, the functions will be triggered
		//		during the window.onbeforeunload event. Be careful of doing
		//		too much work in an unload handler. onbeforeunload can be
		//		triggered if a link to download a file is clicked, or if
		//		the link is a javascript: link. In these cases, the
		//		onbeforeunload event fires, but the document is not
		//		actually destroyed. So be careful about doing destructive
		//		operations in a dojo.addOnUnload callback.
		//
		//		Further note that calling dojo.addOnUnload will prevent
		//		browsers from using a "fast back" cache to make page
		//		loading via back button instantaneous.
		// example:
		//	|	dojo.addOnUnload(functionPointer)
		//	|	dojo.addOnUnload(object, "functionName")
		//	|	dojo.addOnUnload(object, function(){ /* ... */});

		on(win, "beforeunload", lang.hitch(obj, functionName));
	}
};

dojo.addOnWindowUnload = unload.addOnWindowUnload;
dojo.addOnUnload = unload.addOnUnload;

return unload;

});

},
'dijit/main':function(){
define([
	"dojo/_base/kernel"
], function(dojo){
	// module:
	//		dijit/main

/*=====
return {
	// summary:
	//		The dijit package main module.
	//		Deprecated.   Users should access individual modules (ex: dijit/registry) directly.
};
=====*/

	return dojo.dijit;
});

},
'dijit/_Contained':function(){
define([
	"dojo/_base/declare", // declare
	"./registry"	// registry.getEnclosingWidget(), registry.byNode()
], function(declare, registry){

	// module:
	//		dijit/_Contained

	return declare("dijit._Contained", null, {
		// summary:
		//		Mixin for widgets that are children of a container widget
		//
		// example:
		//	|	// make a basic custom widget that knows about it's parents
		//	|	declare("my.customClass",[dijit._Widget,dijit._Contained],{});

		_getSibling: function(/*String*/ which){
			// summary:
			//		Returns next or previous sibling
			// which:
			//		Either "next" or "previous"
			// tags:
			//		private
			var node = this.domNode;
			do{
				node = node[which+"Sibling"];
			}while(node && node.nodeType != 1);
			return node && registry.byNode(node);	// dijit/_WidgetBase
		},

		getPreviousSibling: function(){
			// summary:
			//		Returns null if this is the first child of the parent,
			//		otherwise returns the next element sibling to the "left".

			return this._getSibling("previous"); // dijit/_WidgetBase
		},

		getNextSibling: function(){
			// summary:
			//		Returns null if this is the last child of the parent,
			//		otherwise returns the next element sibling to the "right".

			return this._getSibling("next"); // dijit/_WidgetBase
		},

		getIndexInParent: function(){
			// summary:
			//		Returns the index of this widget within its container parent.
			//		It returns -1 if the parent does not exist, or if the parent
			//		is not a dijit._Container

			var p = this.getParent();
			if(!p || !p.getIndexOfChild){
				return -1; // int
			}
			return p.getIndexOfChild(this); // int
		}
	});
});

},
'dijit/_Container':function(){
define([
	"dojo/_base/array", // array.forEach array.indexOf
	"dojo/_base/declare", // declare
	"dojo/dom-construct" // domConstruct.place
], function(array, declare, domConstruct){

	// module:
	//		dijit/_Container

	return declare("dijit._Container", null, {
		// summary:
		//		Mixin for widgets that contain HTML and/or a set of widget children.

		buildRendering: function(){
			this.inherited(arguments);
			if(!this.containerNode){
				// all widgets with descendants must set containerNode
				this.containerNode = this.domNode;
			}
		},

		addChild: function(/*dijit/_WidgetBase*/ widget, /*int?*/ insertIndex){
			// summary:
			//		Makes the given widget a child of this widget.
			// description:
			//		Inserts specified child widget's dom node as a child of this widget's
			//		container node, and possibly does other processing (such as layout).
			//
			//		Functionality is undefined if this widget contains anything besides
			//		a list of child widgets (ie, if it contains arbitrary non-widget HTML).

			var refNode = this.containerNode;
			if(insertIndex && typeof insertIndex == "number"){
				var children = this.getChildren();
				if(children && children.length >= insertIndex){
					refNode = children[insertIndex-1].domNode;
					insertIndex = "after";
				}
			}
			domConstruct.place(widget.domNode, refNode, insertIndex);

			// If I've been started but the child widget hasn't been started,
			// start it now.  Make sure to do this after widget has been
			// inserted into the DOM tree, so it can see that it's being controlled by me,
			// so it doesn't try to size itself.
			if(this._started && !widget._started){
				widget.startup();
			}
		},

		removeChild: function(/*Widget|int*/ widget){
			// summary:
			//		Removes the passed widget instance from this widget but does
			//		not destroy it.  You can also pass in an integer indicating
			//		the index within the container to remove (ie, removeChild(5) removes the sixth widget).

			if(typeof widget == "number"){
				widget = this.getChildren()[widget];
			}

			if(widget){
				var node = widget.domNode;
				if(node && node.parentNode){
					node.parentNode.removeChild(node); // detach but don't destroy
				}
			}
		},

		hasChildren: function(){
			// summary:
			//		Returns true if widget has child widgets, i.e. if this.containerNode contains widgets.
			return this.getChildren().length > 0;	// Boolean
		},

		_getSiblingOfChild: function(/*dijit/_WidgetBase*/ child, /*int*/ dir){
			// summary:
			//		Get the next or previous widget sibling of child
			// dir:
			//		if 1, get the next sibling
			//		if -1, get the previous sibling
			// tags:
			//		private
			var children = this.getChildren(),
				idx = array.indexOf(this.getChildren(), child);	// int
			return children[idx + dir];
		},

		getIndexOfChild: function(/*dijit/_WidgetBase*/ child){
			// summary:
			//		Gets the index of the child in this container or -1 if not found
			return array.indexOf(this.getChildren(), child);	// int
		}
	});
});

},
'dijit/_WidgetBase':function(){
define([
	"require",			// require.toUrl
	"dojo/_base/array", // array.forEach array.map
	"dojo/aspect",
	"dojo/_base/config", // config.blankGif
	"dojo/_base/connect", // connect.connect
	"dojo/_base/declare", // declare
	"dojo/dom", // dom.byId
	"dojo/dom-attr", // domAttr.set domAttr.remove
	"dojo/dom-class", // domClass.add domClass.replace
	"dojo/dom-construct", // domConstruct.destroy domConstruct.place
	"dojo/dom-geometry",	// isBodyLtr
	"dojo/dom-style", // domStyle.set, domStyle.get
	"dojo/has",
	"dojo/_base/kernel",
	"dojo/_base/lang", // mixin(), isArray(), etc.
	"dojo/on",
	"dojo/ready",
	"dojo/Stateful", // Stateful
	"dojo/topic",
	"dojo/_base/window", // win.doc, win.body()
	"./Destroyable",
	"./registry"	// registry.getUniqueId(), registry.findWidgets()
], function(require, array, aspect, config, connect, declare,
			dom, domAttr, domClass, domConstruct, domGeometry, domStyle, has, kernel,
			lang, on, ready, Stateful, topic, win, Destroyable, registry){

// module:
//		dijit/_WidgetBase

// Flag to make dijit load modules the app didn't explicitly request, for backwards compatibility
 0 && has.add("dijit-legacy-requires", !kernel.isAsync);

// For back-compat, remove in 2.0.
if( 0 ){
	ready(0, function(){
		var requires = ["dijit/_base/manager"];
		require(requires);	// use indirection so modules not rolled into a build
	});
}

// Nested hash listing attributes for each tag, all strings in lowercase.
// ex: {"div": {"style": true, "tabindex" true}, "form": { ...
var tagAttrs = {};
function getAttrs(obj){
	var ret = {};
	for(var attr in obj){
		ret[attr.toLowerCase()] = true;
	}
	return ret;
}

function nonEmptyAttrToDom(attr){
	// summary:
	//		Returns a setter function that copies the attribute to this.domNode,
	//		or removes the attribute from this.domNode, depending on whether the
	//		value is defined or not.
	return function(val){
		domAttr[val ? "set" : "remove"](this.domNode, attr, val);
		this._set(attr, val);
	};
}

return declare("dijit._WidgetBase", [Stateful, Destroyable], {
	// summary:
	//		Future base class for all Dijit widgets.
	// description:
	//		Future base class for all Dijit widgets.
	//		_Widget extends this class adding support for various features needed by desktop.
	//
	//		Provides stubs for widget lifecycle methods for subclasses to extend, like postMixInProperties(), buildRendering(),
	//		postCreate(), startup(), and destroy(), and also public API methods like set(), get(), and watch().
	//
	//		Widgets can provide custom setters/getters for widget attributes, which are called automatically by set(name, value).
	//		For an attribute XXX, define methods _setXXXAttr() and/or _getXXXAttr().
	//
	//		_setXXXAttr can also be a string/hash/array mapping from a widget attribute XXX to the widget's DOMNodes:
	//
	//		- DOM node attribute
	// |		_setFocusAttr: {node: "focusNode", type: "attribute"}
	// |		_setFocusAttr: "focusNode"	(shorthand)
	// |		_setFocusAttr: ""		(shorthand, maps to this.domNode)
	//		Maps this.focus to this.focusNode.focus, or (last example) this.domNode.focus
	//
	//		- DOM node innerHTML
	//	|		_setTitleAttr: { node: "titleNode", type: "innerHTML" }
	//		Maps this.title to this.titleNode.innerHTML
	//
	//		- DOM node innerText
	//	|		_setTitleAttr: { node: "titleNode", type: "innerText" }
	//		Maps this.title to this.titleNode.innerText
	//
	//		- DOM node CSS class
	// |		_setMyClassAttr: { node: "domNode", type: "class" }
	//		Maps this.myClass to this.domNode.className
	//
	//		If the value of _setXXXAttr is an array, then each element in the array matches one of the
	//		formats of the above list.
	//
	//		If the custom setter is null, no action is performed other than saving the new value
	//		in the widget (in this).
	//
	//		If no custom setter is defined for an attribute, then it will be copied
	//		to this.focusNode (if the widget defines a focusNode), or this.domNode otherwise.
	//		That's only done though for attributes that match DOMNode attributes (title,
	//		alt, aria-labelledby, etc.)

	// id: [const] String
	//		A unique, opaque ID string that can be assigned by users or by the
	//		system. If the developer passes an ID which is known not to be
	//		unique, the specified ID is ignored and the system-generated ID is
	//		used instead.
	id: "",
	_setIdAttr: "domNode",	// to copy to this.domNode even for auto-generated id's

	// lang: [const] String
	//		Rarely used.  Overrides the default Dojo locale used to render this widget,
	//		as defined by the [HTML LANG](http://www.w3.org/TR/html401/struct/dirlang.html#adef-lang) attribute.
	//		Value must be among the list of locales specified during by the Dojo bootstrap,
	//		formatted according to [RFC 3066](http://www.ietf.org/rfc/rfc3066.txt) (like en-us).
	lang: "",
	// set on domNode even when there's a focus node.	but don't set lang="", since that's invalid.
	_setLangAttr: nonEmptyAttrToDom("lang"),

	// dir: [const] String
	//		Bi-directional support, as defined by the [HTML DIR](http://www.w3.org/TR/html401/struct/dirlang.html#adef-dir)
	//		attribute. Either left-to-right "ltr" or right-to-left "rtl".  If undefined, widgets renders in page's
	//		default direction.
	dir: "",
	// set on domNode even when there's a focus node.	but don't set dir="", since that's invalid.
	_setDirAttr: nonEmptyAttrToDom("dir"),	// to set on domNode even when there's a focus node

	// textDir: String
	//		Bi-directional support,	the main variable which is responsible for the direction of the text.
	//		The text direction can be different than the GUI direction by using this parameter in creation
	//		of a widget.
	//
	//		Allowed values:
	//
	//		1. "ltr"
	//		2. "rtl"
	//		3. "auto" - contextual the direction of a text defined by first strong letter.
	//
	//		By default is as the page direction.
	textDir: "",

	// class: String
	//		HTML class attribute
	"class": "",
	_setClassAttr: { node: "domNode", type: "class" },

	// style: String||Object
	//		HTML style attributes as cssText string or name/value hash
	style: "",

	// title: String
	//		HTML title attribute.
	//
	//		For form widgets this specifies a tooltip to display when hovering over
	//		the widget (just like the native HTML title attribute).
	//
	//		For TitlePane or for when this widget is a child of a TabContainer, AccordionContainer,
	//		etc., it's used to specify the tab label, accordion pane title, etc.
	title: "",

	// tooltip: String
	//		When this widget's title attribute is used to for a tab label, accordion pane title, etc.,
	//		this specifies the tooltip to appear when the mouse is hovered over that text.
	tooltip: "",

	// baseClass: [protected] String
	//		Root CSS class of the widget (ex: dijitTextBox), used to construct CSS classes to indicate
	//		widget state.
	baseClass: "",

	// srcNodeRef: [readonly] DomNode
	//		pointer to original DOM node
	srcNodeRef: null,

	// domNode: [readonly] DomNode
	//		This is our visible representation of the widget! Other DOM
	//		Nodes may by assigned to other properties, usually through the
	//		template system's data-dojo-attach-point syntax, but the domNode
	//		property is the canonical "top level" node in widget UI.
	domNode: null,

	// containerNode: [readonly] DomNode
	//		Designates where children of the source DOM node will be placed.
	//		"Children" in this case refers to both DOM nodes and widgets.
	//		For example, for myWidget:
	//
	//		|	<div data-dojo-type=myWidget>
	//		|		<b> here's a plain DOM node
	//		|		<span data-dojo-type=subWidget>and a widget</span>
	//		|		<i> and another plain DOM node </i>
	//		|	</div>
	//
	//		containerNode would point to:
	//
	//		|		<b> here's a plain DOM node
	//		|		<span data-dojo-type=subWidget>and a widget</span>
	//		|		<i> and another plain DOM node </i>
	//
	//		In templated widgets, "containerNode" is set via a
	//		data-dojo-attach-point assignment.
	//
	//		containerNode must be defined for any widget that accepts innerHTML
	//		(like ContentPane or BorderContainer or even Button), and conversely
	//		is null for widgets that don't, like TextBox.
	containerNode: null,

	// ownerDocument: [const] Document?
	//		The document this widget belongs to.  If not specified to constructor, will default to
	//		srcNodeRef.ownerDocument, or if no sourceRef specified, then to dojo/_base/window::doc
	ownerDocument: null,
	_setOwnerDocumentAttr: function(val){
		// this setter is merely to avoid automatically trying to set this.domNode.ownerDocument
		this._set("ownerDocument", val);
	},

/*=====
	// _started: [readonly] Boolean
	//		startup() has completed.
	_started: false,
=====*/

	// attributeMap: [protected] Object
	//		Deprecated.	Instead of attributeMap, widget should have a _setXXXAttr attribute
	//		for each XXX attribute to be mapped to the DOM.
	//
	//		attributeMap sets up a "binding" between attributes (aka properties)
	//		of the widget and the widget's DOM.
	//		Changes to widget attributes listed in attributeMap will be
	//		reflected into the DOM.
	//
	//		For example, calling set('title', 'hello')
	//		on a TitlePane will automatically cause the TitlePane's DOM to update
	//		with the new title.
	//
	//		attributeMap is a hash where the key is an attribute of the widget,
	//		and the value reflects a binding to a:
	//
	//		- DOM node attribute
	// |		focus: {node: "focusNode", type: "attribute"}
	//		Maps this.focus to this.focusNode.focus
	//
	//		- DOM node innerHTML
	//	|		title: { node: "titleNode", type: "innerHTML" }
	//		Maps this.title to this.titleNode.innerHTML
	//
	//		- DOM node innerText
	//	|		title: { node: "titleNode", type: "innerText" }
	//		Maps this.title to this.titleNode.innerText
	//
	//		- DOM node CSS class
	// |		myClass: { node: "domNode", type: "class" }
	//		Maps this.myClass to this.domNode.className
	//
	//		If the value is an array, then each element in the array matches one of the
	//		formats of the above list.
	//
	//		There are also some shorthands for backwards compatibility:
	//
	//		- string --> { node: string, type: "attribute" }, for example:
	//
	//	|	"focusNode" ---> { node: "focusNode", type: "attribute" }
	//
	//		- "" --> { node: "domNode", type: "attribute" }
	attributeMap: {},

	// _blankGif: [protected] String
	//		Path to a blank 1x1 image.
	//		Used by `<img>` nodes in templates that really get their image via CSS background-image.
	_blankGif: config.blankGif || require.toUrl("dojo/resources/blank.gif"),

	//////////// INITIALIZATION METHODS ///////////////////////////////////////

	/*=====
	constructor: function(params, srcNodeRef){
		// summary:
		//		Create the widget.
		// params: Object|null
		//		Hash of initialization parameters for widget, including scalar values (like title, duration etc.)
		//		and functions, typically callbacks like onClick.
	 	//		The hash can contain any of the widget's properties, excluding read-only properties.
	 	// srcNodeRef: DOMNode|String?
		//		If a srcNodeRef (DOM node) is specified:
		//
		//		- use srcNodeRef.innerHTML as my contents
		//		- if this is a behavioral widget then apply behavior to that srcNodeRef
		//		- otherwise, replace srcNodeRef with my generated DOM tree
	 },
	=====*/

	postscript: function(/*Object?*/params, /*DomNode|String*/srcNodeRef){
		// summary:
		//		Kicks off widget instantiation.  See create() for details.
		// tags:
		//		private
		this.create(params, srcNodeRef);
	},

	create: function(params, srcNodeRef){
		// summary:
		//		Kick off the life-cycle of a widget
		// description:
		//		Create calls a number of widget methods (postMixInProperties, buildRendering, postCreate,
		//		etc.), some of which of you'll want to override. See http://dojotoolkit.org/reference-guide/dijit/_WidgetBase.html
		//		for a discussion of the widget creation lifecycle.
		//
		//		Of course, adventurous developers could override create entirely, but this should
		//		only be done as a last resort.
		// params: Object|null
		//		Hash of initialization parameters for widget, including scalar values (like title, duration etc.)
		//		and functions, typically callbacks like onClick.
		//		The hash can contain any of the widget's properties, excluding read-only properties.
		// srcNodeRef: DOMNode|String?
		//		If a srcNodeRef (DOM node) is specified:
		//
		//		- use srcNodeRef.innerHTML as my contents
		//		- if this is a behavioral widget then apply behavior to that srcNodeRef
		//		- otherwise, replace srcNodeRef with my generated DOM tree
		// tags:
		//		private

		// store pointer to original DOM tree
		this.srcNodeRef = dom.byId(srcNodeRef);

		// No longer used, remove for 2.0.
		this._connects = [];
		this._supportingWidgets = [];

		// this is here for back-compat, remove in 2.0 (but check NodeList-instantiate.html test)
		if(this.srcNodeRef && (typeof this.srcNodeRef.id == "string")){ this.id = this.srcNodeRef.id; }

		// mix in our passed parameters
		if(params){
			this.params = params;
			lang.mixin(this, params);
		}
		this.postMixInProperties();

		// Generate an id for the widget if one wasn't specified, or it was specified as id: undefined.
		// Do this before buildRendering() because it might expect the id to be there.
		if(!this.id){
			this.id = registry.getUniqueId(this.declaredClass.replace(/\./g,"_"));
			if(this.params){
				// if params contains {id: undefined}, prevent _applyAttributes() from processing it
				delete this.params.id;
			}
		}

		// The document and <body> node this widget is associated with
		this.ownerDocument = this.ownerDocument || (this.srcNodeRef ? this.srcNodeRef.ownerDocument : win.doc);
		this.ownerDocumentBody = win.body(this.ownerDocument);

		registry.add(this);

		this.buildRendering();

		var deleteSrcNodeRef;

		if(this.domNode){
			// Copy attributes listed in attributeMap into the [newly created] DOM for the widget.
			// Also calls custom setters for all attributes with custom setters.
			this._applyAttributes();

			// If srcNodeRef was specified, then swap out original srcNode for this widget's DOM tree.
			// For 2.0, move this after postCreate().  postCreate() shouldn't depend on the
			// widget being attached to the DOM since it isn't when a widget is created programmatically like
			// new MyWidget({}).	See #11635.
			var source = this.srcNodeRef;
			if(source && source.parentNode && this.domNode !== source){
				source.parentNode.replaceChild(this.domNode, source);
				deleteSrcNodeRef = true;
			}

			// Note: for 2.0 may want to rename widgetId to dojo._scopeName + "_widgetId",
			// assuming that dojo._scopeName even exists in 2.0
			this.domNode.setAttribute("widgetId", this.id);
		}
		this.postCreate();

		// If srcNodeRef has been processed and removed from the DOM (e.g. TemplatedWidget) then delete it to allow GC.
		// I think for back-compatibility it isn't deleting srcNodeRef until after postCreate() has run.
		if(deleteSrcNodeRef){
			delete this.srcNodeRef;
		}

		this._created = true;
	},

	_applyAttributes: function(){
		// summary:
		//		Step during widget creation to copy  widget attributes to the
		//		DOM according to attributeMap and _setXXXAttr objects, and also to call
		//		custom _setXXXAttr() methods.
		//
		//		Skips over blank/false attribute values, unless they were explicitly specified
		//		as parameters to the widget, since those are the default anyway,
		//		and setting tabIndex="" is different than not setting tabIndex at all.
		//
		//		For backwards-compatibility reasons attributeMap overrides _setXXXAttr when
		//		_setXXXAttr is a hash/string/array, but _setXXXAttr as a functions override attributeMap.
		// tags:
		//		private

		// Get list of attributes where this.set(name, value) will do something beyond
		// setting this[name] = value.  Specifically, attributes that have:
		//		- associated _setXXXAttr() method/hash/string/array
		//		- entries in attributeMap (remove this for 2.0);
		var ctor = this.constructor,
			list = ctor._setterAttrs;
		if(!list){
			list = (ctor._setterAttrs = []);
			for(var attr in this.attributeMap){
				list.push(attr);
			}

			var proto = ctor.prototype;
			for(var fxName in proto){
				if(fxName in this.attributeMap){ continue; }
				var setterName = "_set" + fxName.replace(/^[a-z]|-[a-zA-Z]/g, function(c){ return c.charAt(c.length-1).toUpperCase(); }) + "Attr";
				if(setterName in proto){
					list.push(fxName);
				}
			}
		}

		// Call this.set() for each property that was either specified as parameter to constructor,
		// or is in the list found above.	For correlated properties like value and displayedValue, the one
		// specified as a parameter should take precedence.
		// Particularly important for new DateTextBox({displayedValue: ...}) since DateTextBox's default value is
		// NaN and thus is not ignored like a default value of "".

		// Step 1: Save the current values of the widget properties that were specified as parameters to the constructor.
		// Generally this.foo == this.params.foo, except if postMixInProperties() changed the value of this.foo.
		var params = {};
		for(var key in this.params || {}){
			params[key] = this[key];
		}

		// Step 2: Call set() for each property that wasn't passed as a parameter to the constructor
		array.forEach(list, function(attr){
			if(attr in params){
				// skip this one, do it below
			}else if(this[attr]){
				this.set(attr, this[attr]);
			}
		}, this);

		// Step 3: Call set() for each property that was specified as parameter to constructor.
		// Use params hash created above to ignore side effects from step #2 above.
		for(key in params){
			this.set(key, params[key]);
		}
	},

	postMixInProperties: function(){
		// summary:
		//		Called after the parameters to the widget have been read-in,
		//		but before the widget template is instantiated. Especially
		//		useful to set properties that are referenced in the widget
		//		template.
		// tags:
		//		protected
	},

	buildRendering: function(){
		// summary:
		//		Construct the UI for this widget, setting this.domNode.
		//		Most widgets will mixin `dijit._TemplatedMixin`, which implements this method.
		// tags:
		//		protected

		if(!this.domNode){
			// Create root node if it wasn't created by _Templated
			this.domNode = this.srcNodeRef || this.ownerDocument.createElement("div");
		}

		// baseClass is a single class name or occasionally a space-separated list of names.
		// Add those classes to the DOMNode.  If RTL mode then also add with Rtl suffix.
		// TODO: make baseClass custom setter
		if(this.baseClass){
			var classes = this.baseClass.split(" ");
			if(!this.isLeftToRight()){
				classes = classes.concat( array.map(classes, function(name){ return name+"Rtl"; }));
			}
			domClass.add(this.domNode, classes);
		}
	},

	postCreate: function(){
		// summary:
		//		Processing after the DOM fragment is created
		// description:
		//		Called after the DOM fragment has been created, but not necessarily
		//		added to the document.  Do not include any operations which rely on
		//		node dimensions or placement.
		// tags:
		//		protected
	},

	startup: function(){
		// summary:
		//		Processing after the DOM fragment is added to the document
		// description:
		//		Called after a widget and its children have been created and added to the page,
		//		and all related widgets have finished their create() cycle, up through postCreate().
		//		This is useful for composite widgets that need to control or layout sub-widgets.
		//		Many layout widgets can use this as a wiring phase.
		if(this._started){ return; }
		this._started = true;
		array.forEach(this.getChildren(), function(obj){
			if(!obj._started && !obj._destroyed && lang.isFunction(obj.startup)){
				obj.startup();
				obj._started = true;
			}
		});
	},

	//////////// DESTROY FUNCTIONS ////////////////////////////////

	destroyRecursive: function(/*Boolean?*/ preserveDom){
		// summary:
		//		Destroy this widget and its descendants
		// description:
		//		This is the generic "destructor" function that all widget users
		//		should call to cleanly discard with a widget. Once a widget is
		//		destroyed, it is removed from the manager object.
		// preserveDom:
		//		If true, this method will leave the original DOM structure
		//		alone of descendant Widgets. Note: This will NOT work with
		//		dijit._Templated widgets.

		this._beingDestroyed = true;
		this.destroyDescendants(preserveDom);
		this.destroy(preserveDom);
	},

	destroy: function(/*Boolean*/ preserveDom){
		// summary:
		//		Destroy this widget, but not its descendants.
		//		This method will, however, destroy internal widgets such as those used within a template.
		// preserveDom: Boolean
		//		If true, this method will leave the original DOM structure alone.
		//		Note: This will not yet work with _Templated widgets

		this._beingDestroyed = true;
		this.uninitialize();

		function destroy(w){
			if(w.destroyRecursive){
				w.destroyRecursive(preserveDom);
			}else if(w.destroy){
				w.destroy(preserveDom);
			}
		}

		// Back-compat, remove for 2.0
		array.forEach(this._connects, lang.hitch(this, "disconnect"));
		array.forEach(this._supportingWidgets, destroy);

		// Destroy supporting widgets, but not child widgets under this.containerNode (for 2.0, destroy child widgets
		// here too).   if() statement is to guard against exception if destroy() called multiple times (see #15815).
		if(this.domNode){
			array.forEach(registry.findWidgets(this.domNode, this.containerNode), destroy);
		}

		this.destroyRendering(preserveDom);
		registry.remove(this.id);
		this._destroyed = true;
	},

	destroyRendering: function(/*Boolean?*/ preserveDom){
		// summary:
		//		Destroys the DOM nodes associated with this widget
		// preserveDom:
		//		If true, this method will leave the original DOM structure alone
		//		during tear-down. Note: this will not work with _Templated
		//		widgets yet.
		// tags:
		//		protected

		if(this.bgIframe){
			this.bgIframe.destroy(preserveDom);
			delete this.bgIframe;
		}

		if(this.domNode){
			if(preserveDom){
				domAttr.remove(this.domNode, "widgetId");
			}else{
				domConstruct.destroy(this.domNode);
			}
			delete this.domNode;
		}

		if(this.srcNodeRef){
			if(!preserveDom){
				domConstruct.destroy(this.srcNodeRef);
			}
			delete this.srcNodeRef;
		}
	},

	destroyDescendants: function(/*Boolean?*/ preserveDom){
		// summary:
		//		Recursively destroy the children of this widget and their
		//		descendants.
		// preserveDom:
		//		If true, the preserveDom attribute is passed to all descendant
		//		widget's .destroy() method. Not for use with _Templated
		//		widgets.

		// get all direct descendants and destroy them recursively
		array.forEach(this.getChildren(), function(widget){
			if(widget.destroyRecursive){
				widget.destroyRecursive(preserveDom);
			}
		});
	},

	uninitialize: function(){
		// summary:
		//		Deprecated. Override destroy() instead to implement custom widget tear-down
		//		behavior.
		// tags:
		//		protected
		return false;
	},

	////////////////// GET/SET, CUSTOM SETTERS, ETC. ///////////////////

	_setStyleAttr: function(/*String||Object*/ value){
		// summary:
		//		Sets the style attribute of the widget according to value,
		//		which is either a hash like {height: "5px", width: "3px"}
		//		or a plain string
		// description:
		//		Determines which node to set the style on based on style setting
		//		in attributeMap.
		// tags:
		//		protected

		var mapNode = this.domNode;

		// Note: technically we should revert any style setting made in a previous call
		// to his method, but that's difficult to keep track of.

		if(lang.isObject(value)){
			domStyle.set(mapNode, value);
		}else{
			if(mapNode.style.cssText){
				mapNode.style.cssText += "; " + value;
			}else{
				mapNode.style.cssText = value;
			}
		}

		this._set("style", value);
	},

	_attrToDom: function(/*String*/ attr, /*String*/ value, /*Object?*/ commands){
		// summary:
		//		Reflect a widget attribute (title, tabIndex, duration etc.) to
		//		the widget DOM, as specified by commands parameter.
		//		If commands isn't specified then it's looked up from attributeMap.
		//		Note some attributes like "type"
		//		cannot be processed this way as they are not mutable.
		// attr:
		//		Name of member variable (ex: "focusNode" maps to this.focusNode) pointing
		//		to DOMNode inside the widget, or alternately pointing to a subwidget
		// tags:
		//		private

		commands = arguments.length >= 3 ? commands : this.attributeMap[attr];

		array.forEach(lang.isArray(commands) ? commands : [commands], function(command){

			// Get target node and what we are doing to that node
			var mapNode = this[command.node || command || "domNode"];	// DOM node
			var type = command.type || "attribute";	// class, innerHTML, innerText, or attribute

			switch(type){
				case "attribute":
					if(lang.isFunction(value)){ // functions execute in the context of the widget
						value = lang.hitch(this, value);
					}

					// Get the name of the DOM node attribute; usually it's the same
					// as the name of the attribute in the widget (attr), but can be overridden.
					// Also maps handler names to lowercase, like onSubmit --> onsubmit
					var attrName = command.attribute ? command.attribute :
						(/^on[A-Z][a-zA-Z]*$/.test(attr) ? attr.toLowerCase() : attr);

					if(mapNode.tagName){
						// Normal case, mapping to a DOMNode.  Note that modern browsers will have a mapNode.set()
						// method, but for consistency we still call domAttr
						domAttr.set(mapNode, attrName, value);
					}else{
						// mapping to a sub-widget
						mapNode.set(attrName, value);
					}
					break;
				case "innerText":
					mapNode.innerHTML = "";
					mapNode.appendChild(this.ownerDocument.createTextNode(value));
					break;
				case "innerHTML":
					mapNode.innerHTML = value;
					break;
				case "class":
					domClass.replace(mapNode, value, this[attr]);
					break;
			}
		}, this);
	},

	get: function(name){
		// summary:
		//		Get a property from a widget.
		// name:
		//		The property to get.
		// description:
		//		Get a named property from a widget. The property may
		//		potentially be retrieved via a getter method. If no getter is defined, this
		//		just retrieves the object's property.
		//
		//		For example, if the widget has properties `foo` and `bar`
		//		and a method named `_getFooAttr()`, calling:
		//		`myWidget.get("foo")` would be equivalent to calling
		//		`widget._getFooAttr()` and `myWidget.get("bar")`
		//		would be equivalent to the expression
		//		`widget.bar2`
		var names = this._getAttrNames(name);
		return this[names.g] ? this[names.g]() : this[name];
	},

	set: function(name, value){
		// summary:
		//		Set a property on a widget
		// name:
		//		The property to set.
		// value:
		//		The value to set in the property.
		// description:
		//		Sets named properties on a widget which may potentially be handled by a
		//		setter in the widget.
		//
		//		For example, if the widget has properties `foo` and `bar`
		//		and a method named `_setFooAttr()`, calling
		//		`myWidget.set("foo", "Howdy!")` would be equivalent to calling
		//		`widget._setFooAttr("Howdy!")` and `myWidget.set("bar", 3)`
		//		would be equivalent to the statement `widget.bar = 3;`
		//
		//		set() may also be called with a hash of name/value pairs, ex:
		//
		//	|	myWidget.set({
		//	|		foo: "Howdy",
		//	|		bar: 3
		//	|	});
		//
		//	This is equivalent to calling `set(foo, "Howdy")` and `set(bar, 3)`

		if(typeof name === "object"){
			for(var x in name){
				this.set(x, name[x]);
			}
			return this;
		}
		var names = this._getAttrNames(name),
			setter = this[names.s];
		if(lang.isFunction(setter)){
			// use the explicit setter
			var result = setter.apply(this, Array.prototype.slice.call(arguments, 1));
		}else{
			// Mapping from widget attribute to DOMNode/subwidget attribute/value/etc.
			// Map according to:
			//		1. attributeMap setting, if one exists (TODO: attributeMap deprecated, remove in 2.0)
			//		2. _setFooAttr: {...} type attribute in the widget (if one exists)
			//		3. apply to focusNode or domNode if standard attribute name, excluding funcs like onClick.
			// Checks if an attribute is a "standard attribute" by whether the DOMNode JS object has a similar
			// attribute name (ex: accept-charset attribute matches jsObject.acceptCharset).
			// Note also that Tree.focusNode() is a function not a DOMNode, so test for that.
			var defaultNode = this.focusNode && !lang.isFunction(this.focusNode) ? "focusNode" : "domNode",
				tag = this[defaultNode].tagName,
				attrsForTag = tagAttrs[tag] || (tagAttrs[tag] = getAttrs(this[defaultNode])),
				map =	name in this.attributeMap ? this.attributeMap[name] :
						names.s in this ? this[names.s] :
						((names.l in attrsForTag && typeof value != "function") ||
							/^aria-|^data-|^role$/.test(name)) ? defaultNode : null;
			if(map != null){
				this._attrToDom(name, value, map);
			}
			this._set(name, value);
		}
		return result || this;
	},

	_attrPairNames: {},		// shared between all widgets
	_getAttrNames: function(name){
		// summary:
		//		Helper function for get() and set().
		//		Caches attribute name values so we don't do the string ops every time.
		// tags:
		//		private

		var apn = this._attrPairNames;
		if(apn[name]){ return apn[name]; }
		var uc = name.replace(/^[a-z]|-[a-zA-Z]/g, function(c){ return c.charAt(c.length-1).toUpperCase(); });
		return (apn[name] = {
			n: name+"Node",
			s: "_set"+uc+"Attr",	// converts dashes to camel case, ex: accept-charset --> _setAcceptCharsetAttr
			g: "_get"+uc+"Attr",
			l: uc.toLowerCase()		// lowercase name w/out dashes, ex: acceptcharset
		});
	},

	_set: function(/*String*/ name, /*anything*/ value){
		// summary:
		//		Helper function to set new value for specified attribute, and call handlers
		//		registered with watch() if the value has changed.
		var oldValue = this[name];
		this[name] = value;
		if(this._created && value !== oldValue){
			if(this._watchCallbacks){
				this._watchCallbacks(name, oldValue, value);
			}
			this.emit("attrmodified-" + name, {
				detail: {
					prevValue: oldValue,
					newValue: value
				}
			});
		}
	},

	emit: function(/*String*/ type, /*Object?*/ eventObj, /*Array?*/ callbackArgs){
		// summary:
		//		Used by widgets to signal that a synthetic event occurred, ex:
		//	|	myWidget.emit("attrmodified-selectedChildWidget", {}).
		//
		//		Emits an event on this.domNode named type.toLowerCase(), based on eventObj.
		//		Also calls onType() method, if present, and returns value from that method.
		//		By default passes eventObj to callback, but will pass callbackArgs instead, if specified.
		//		Modifies eventObj by adding missing parameters (bubbles, cancelable, widget).
		// tags:
		//		protected

		// Specify fallback values for bubbles, cancelable in case they are not set in eventObj.
		// Also set pointer to widget, although since we can't add a pointer to the widget for native events
		// (see #14729), maybe we shouldn't do it here?
		eventObj = eventObj || {};
		if(eventObj.bubbles === undefined){ eventObj.bubbles = true; }
		if(eventObj.cancelable === undefined){ eventObj.cancelable = true; }
		if(!eventObj.detail){ eventObj.detail = {}; }
		eventObj.detail.widget = this;

		var ret, callback = this["on"+type];
		if(callback){
			ret = callback.apply(this, callbackArgs ? callbackArgs : [eventObj]);
		}

		// Emit event, but avoid spurious emit()'s as parent sets properties on child during startup/destroy
		if(this._started && !this._beingDestroyed){
			on.emit(this.domNode, type.toLowerCase(), eventObj);
		}

		return ret;
	},

	on: function(/*String|Function*/ type, /*Function*/ func){
		// summary:
		//		Call specified function when event occurs, ex: myWidget.on("click", function(){ ... }).
		// type:
		//		Name of event (ex: "click") or extension event like touch.press.
		// description:
		//		Call specified function when event `type` occurs, ex: `myWidget.on("click", function(){ ... })`.
		//		Note that the function is not run in any particular scope, so if (for example) you want it to run in the
		//		widget's scope you must do `myWidget.on("click", lang.hitch(myWidget, func))`.

		// For backwards compatibility, if there's an onType() method in the widget then connect to that.
		// Remove in 2.0.
		var widgetMethod = this._onMap(type);
		if(widgetMethod){
			return aspect.after(this, widgetMethod, func, true);
		}

		// Otherwise, just listen for the event on this.domNode.
		return this.own(on(this.domNode, type, func))[0];
	},

	_onMap: function(/*String|Function*/ type){
		// summary:
		//		Maps on() type parameter (ex: "mousemove") to method name (ex: "onMouseMove").
		//		If type is a synthetic event like touch.press then returns undefined.
		var ctor = this.constructor, map = ctor._onMap;
		if(!map){
			map = (ctor._onMap = {});
			for(var attr in ctor.prototype){
				if(/^on/.test(attr)){
					map[attr.replace(/^on/, "").toLowerCase()] = attr;
				}
			}
		}
		return map[typeof type == "string" && type.toLowerCase()];	// String
	},

	toString: function(){
		// summary:
		//		Returns a string that represents the widget
		// description:
		//		When a widget is cast to a string, this method will be used to generate the
		//		output. Currently, it does not implement any sort of reversible
		//		serialization.
		return '[Widget ' + this.declaredClass + ', ' + (this.id || 'NO ID') + ']'; // String
	},

	getChildren: function(){
		// summary:
		//		Returns all the widgets contained by this, i.e., all widgets underneath this.containerNode.
		//		Does not return nested widgets, nor widgets that are part of this widget's template.
		return this.containerNode ? registry.findWidgets(this.containerNode) : []; // dijit/_WidgetBase[]
	},

	getParent: function(){
		// summary:
		//		Returns the parent widget of this widget
		return registry.getEnclosingWidget(this.domNode.parentNode);
	},

	connect: function(
			/*Object|null*/ obj,
			/*String|Function*/ event,
			/*String|Function*/ method){
		// summary:
		//		Deprecated, will be removed in 2.0, use this.own(on(...)) or this.own(aspect.after(...)) instead.
		//
		//		Connects specified obj/event to specified method of this object
		//		and registers for disconnect() on widget destroy.
		//
		//		Provide widget-specific analog to dojo.connect, except with the
		//		implicit use of this widget as the target object.
		//		Events connected with `this.connect` are disconnected upon
		//		destruction.
		// returns:
		//		A handle that can be passed to `disconnect` in order to disconnect before
		//		the widget is destroyed.
		// example:
		//	|	var btn = new Button();
		//	|	// when foo.bar() is called, call the listener we're going to
		//	|	// provide in the scope of btn
		//	|	btn.connect(foo, "bar", function(){
		//	|		0 && console.debug(this.toString());
		//	|	});
		// tags:
		//		protected

		return this.own(connect.connect(obj, event, this, method))[0];	// handle
	},

	disconnect: function(handle){
		// summary:
		//		Deprecated, will be removed in 2.0, use handle.remove() instead.
		//
		//		Disconnects handle created by `connect`.
		// tags:
		//		protected

		handle.remove();
	},

	subscribe: function(t, method){
		// summary:
		//		Deprecated, will be removed in 2.0, use this.own(topic.subscribe()) instead.
		//
		//		Subscribes to the specified topic and calls the specified method
		//		of this object and registers for unsubscribe() on widget destroy.
		//
		//		Provide widget-specific analog to dojo.subscribe, except with the
		//		implicit use of this widget as the target object.
		// t: String
		//		The topic
		// method: Function
		//		The callback
		// example:
		//	|	var btn = new Button();
		//	|	// when /my/topic is published, this button changes its label to
		//	|	// be the parameter of the topic.
		//	|	btn.subscribe("/my/topic", function(v){
		//	|		this.set("label", v);
		//	|	});
		// tags:
		//		protected
		return this.own(topic.subscribe(t, lang.hitch(this, method)))[0];	// handle
	},

	unsubscribe: function(/*Object*/ handle){
		// summary:
		//		Deprecated, will be removed in 2.0, use handle.remove() instead.
		//
		//		Unsubscribes handle created by this.subscribe.
		//		Also removes handle from this widget's list of subscriptions
		// tags:
		//		protected

		handle.remove();
	},

	isLeftToRight: function(){
		// summary:
		//		Return this widget's explicit or implicit orientation (true for LTR, false for RTL)
		// tags:
		//		protected
		return this.dir ? (this.dir == "ltr") : domGeometry.isBodyLtr(this.ownerDocument); //Boolean
	},

	isFocusable: function(){
		// summary:
		//		Return true if this widget can currently be focused
		//		and false if not
		return this.focus && (domStyle.get(this.domNode, "display") != "none");
	},

	placeAt: function(/* String|DomNode|_Widget */ reference, /* String|Int? */ position){
		// summary:
		//		Place this widget somewhere in the DOM based
		//		on standard domConstruct.place() conventions.
		// description:
		//		A convenience function provided in all _Widgets, providing a simple
		//		shorthand mechanism to put an existing (or newly created) Widget
		//		somewhere in the dom, and allow chaining.
		// reference:
		//		Widget, DOMNode, or id of widget or DOMNode
		// position:
		//		If reference is a widget (or id of widget), and that widget has an ".addChild" method,
		//		it will be called passing this widget instance into that method, supplying the optional
		//		position index passed.  In this case position (if specified) should be an integer.
		//
		//		If reference is a DOMNode (or id matching a DOMNode but not a widget),
		//		the position argument can be a numeric index or a string
		//		"first", "last", "before", or "after", same as dojo/dom-construct::place().
		// returns: dijit/_WidgetBase
		//		Provides a useful return of the newly created dijit._Widget instance so you
		//		can "chain" this function by instantiating, placing, then saving the return value
		//		to a variable.
		// example:
		//	|	// create a Button with no srcNodeRef, and place it in the body:
		//	|	var button = new Button({ label:"click" }).placeAt(win.body());
		//	|	// now, 'button' is still the widget reference to the newly created button
		//	|	button.on("click", function(e){ 0 && console.log('click'); }));
		// example:
		//	|	// create a button out of a node with id="src" and append it to id="wrapper":
		//	|	var button = new Button({},"src").placeAt("wrapper");
		// example:
		//	|	// place a new button as the first element of some div
		//	|	var button = new Button({ label:"click" }).placeAt("wrapper","first");
		// example:
		//	|	// create a contentpane and add it to a TabContainer
		//	|	var tc = dijit.byId("myTabs");
		//	|	new ContentPane({ href:"foo.html", title:"Wow!" }).placeAt(tc)

		var refWidget = !reference.tagName && registry.byId(reference);
		if(refWidget && refWidget.addChild && (!position || typeof position === "number")){
			// Adding this to refWidget and can use refWidget.addChild() to handle everything.
			refWidget.addChild(this, position);
		}else{
			// "reference" is a plain DOMNode, or we can't use refWidget.addChild().   Use domConstruct.place() and
			// target refWidget.containerNode for nested placement (position==number, "first", "last", "only"), and
			// refWidget.domNode otherwise ("after"/"before"/"replace").  (But not supported officially, see #14946.)
			var ref = refWidget ?
				(refWidget.containerNode && !/after|before|replace/.test(position||"") ?
					refWidget.containerNode : refWidget.domNode) : dom.byId(reference, this.ownerDocument);
			domConstruct.place(this.domNode, ref, position);

			// Start this iff it has a parent widget that's already started.
			if(!this._started && (this.getParent() || {})._started){
				this.startup();
			}
		}
		return this;
	},

	getTextDir: function(/*String*/ text,/*String*/ originalDir){
		// summary:
		//		Return direction of the text.
		//		The function overridden in the _BidiSupport module,
		//		its main purpose is to calculate the direction of the
		//		text, if was defined by the programmer through textDir.
		// tags:
		//		protected.
		return originalDir;
	},

	applyTextDir: function(/*===== element, text =====*/){
		// summary:
		//		The function overridden in the _BidiSupport module,
		//		originally used for setting element.dir according to this.textDir.
		//		In this case does nothing.
		// element: DOMNode
		// text: String
		// tags:
		//		protected.
	},

	defer: function(fcn, delay){ 
		// summary:
		//		Wrapper to setTimeout to avoid deferred functions executing
		//		after the originating widget has been destroyed.
		//		Returns an object handle with a remove method (that returns null) (replaces clearTimeout).
		// fcn: function reference
		// delay: Optional number (defaults to 0)
		// tags:
		//		protected.
		var timer = setTimeout(lang.hitch(this, 
			function(){ 
				timer = null;
				if(!this._destroyed){ 
					lang.hitch(this, fcn)(); 
				} 
			}),
			delay || 0
		);
		return {
			remove:	function(){
					if(timer){
						clearTimeout(timer);
						timer = null;
					}
					return null; // so this works well: handle = handle.remove();
				}
		};
	}
});

});

},
'dojo/Stateful':function(){
define(["./_base/declare", "./_base/lang", "./_base/array", "dojo/when"], function(declare, lang, array, when){
	// module:
	//		dojo/Stateful

return declare("dojo.Stateful", null, {
	// summary:
	//		Base class for objects that provide named properties with optional getter/setter
	//		control and the ability to watch for property changes
	//
	//		The class also provides the functionality to auto-magically manage getters
	//		and setters for object attributes/properties.
	//		
	//		Getters and Setters should follow the format of _xxxGetter or _xxxSetter where 
	//		the xxx is a name of the attribute to handle.  So an attribute of "foo" 
	//		would have a custom getter of _fooGetter and a custom setter of _fooSetter.
	//
	// example:
	//	|	var obj = new dojo.Stateful();
	//	|	obj.watch("foo", function(){
	//	|		0 && console.log("foo changed to " + this.get("foo"));
	//	|	});
	//	|	obj.set("foo","bar");

	// _attrPairNames: Hash
	//		Used across all instances a hash to cache attribute names and their getter 
	//		and setter names.
	_attrPairNames: {},

	_getAttrNames: function(name){
		// summary:
		//		Helper function for get() and set().
		//		Caches attribute name values so we don't do the string ops every time.
		// tags:
		//		private

		var apn = this._attrPairNames;
		if(apn[name]){ return apn[name]; }
		return (apn[name] = {
			s: "_" + name + "Setter",
			g: "_" + name + "Getter"
		});
	},

	postscript: function(/*Object?*/ params){
		// Automatic setting of params during construction
		if (params){ this.set(params); }
	},

	_get: function(name, names){
		// summary:
		//		Private function that does a get based off a hash of names
		// names:
		//		Hash of names of custom attributes
		return typeof this[names.g] === "function" ? this[names.g]() : this[name];
	},
	get: function(/*String*/name){
		// summary:
		//		Get a property on a Stateful instance.
		// name:
		//		The property to get.
		// returns:
		//		The property value on this Stateful instance.
		// description:
		//		Get a named property on a Stateful object. The property may
		//		potentially be retrieved via a getter method in subclasses. In the base class
		//		this just retrieves the object's property.
		//		For example:
		//	|	stateful = new dojo.Stateful({foo: 3});
		//	|	stateful.get("foo") // returns 3
		//	|	stateful.foo // returns 3

		return this._get(name, this._getAttrNames(name)); //Any
	},
	set: function(/*String*/name, /*Object*/value){
		// summary:
		//		Set a property on a Stateful instance
		// name:
		//		The property to set.
		// value:
		//		The value to set in the property.
		// returns:
		//		The function returns this dojo.Stateful instance.
		// description:
		//		Sets named properties on a stateful object and notifies any watchers of
		//		the property. A programmatic setter may be defined in subclasses.
		//		For example:
		//	|	stateful = new dojo.Stateful();
		//	|	stateful.watch(function(name, oldValue, value){
		//	|		// this will be called on the set below
		//	|	}
		//	|	stateful.set(foo, 5);
		//
		//	set() may also be called with a hash of name/value pairs, ex:
		//	|	myObj.set({
		//	|		foo: "Howdy",
		//	|		bar: 3
		//	|	})
		//	This is equivalent to calling set(foo, "Howdy") and set(bar, 3)

		// If an object is used, iterate through object
		if(typeof name === "object"){
			for(var x in name){
				if(name.hasOwnProperty(x) && x !="_watchCallbacks"){
					this.set(x, name[x]);
				}
			}
			return this;
		}

		var names = this._getAttrNames(name),
			oldValue = this._get(name, names),
			setter = this[names.s],
			result;
		if(typeof setter === "function"){
			// use the explicit setter
			result = setter.apply(this, Array.prototype.slice.call(arguments, 1));
		}else{
			// no setter so set attribute directly
			this[name] = value;
		}
		if(this._watchCallbacks){
			var self = this;
			// If setter returned a promise, wait for it to complete, otherwise call watches immediatly
			when(result, function(){
				self._watchCallbacks(name, oldValue, value);
			});
		}
		return this; // dojo/Stateful
	},
	_changeAttrValue: function(name, value){
		// summary:
		//		Internal helper for directly changing an attribute value.
		//
		// name: String
		//		The property to set.
		// value: Mixed
		//		The value to set in the property.
		//
		// description:
		//		Directly change the value of an attribute on an object, bypassing any 
		//		accessor setter.  Also handles the calling of watch and emitting events. 
		//		It is designed to be used by descendent class when there are two values 
		//		of attributes that are linked, but calling .set() is not appropriate.

		var oldValue = this.get(name);
		this[name] = value;
		if(this._watchCallbacks){
			this._watchCallbacks(name, oldValue, value);
		}
		return this; // dojo/Stateful
	},
	watch: function(/*String?*/name, /*Function*/callback){
		// summary:
		//		Watches a property for changes
		// name:
		//		Indicates the property to watch. This is optional (the callback may be the
		//		only parameter), and if omitted, all the properties will be watched
		// returns:
		//		An object handle for the watch. The unwatch method of this object
		//		can be used to discontinue watching this property:
		//		|	var watchHandle = obj.watch("foo", callback);
		//		|	watchHandle.unwatch(); // callback won't be called now
		// callback:
		//		The function to execute when the property changes. This will be called after
		//		the property has been changed. The callback will be called with the |this|
		//		set to the instance, the first argument as the name of the property, the
		//		second argument as the old value and the third argument as the new value.

		var callbacks = this._watchCallbacks;
		if(!callbacks){
			var self = this;
			callbacks = this._watchCallbacks = function(name, oldValue, value, ignoreCatchall){
				var notify = function(propertyCallbacks){
					if(propertyCallbacks){
						propertyCallbacks = propertyCallbacks.slice();
						for(var i = 0, l = propertyCallbacks.length; i < l; i++){
							propertyCallbacks[i].call(self, name, oldValue, value);
						}
					}
				};
				notify(callbacks['_' + name]);
				if(!ignoreCatchall){
					notify(callbacks["*"]); // the catch-all
				}
			}; // we use a function instead of an object so it will be ignored by JSON conversion
		}
		if(!callback && typeof name === "function"){
			callback = name;
			name = "*";
		}else{
			// prepend with dash to prevent name conflicts with function (like "name" property)
			name = '_' + name;
		}
		var propertyCallbacks = callbacks[name];
		if(typeof propertyCallbacks !== "object"){
			propertyCallbacks = callbacks[name] = [];
		}
		propertyCallbacks.push(callback);

		// TODO: Remove unwatch in 2.0
		var handle = {};
		handle.unwatch = handle.remove = function(){
			var index = array.indexOf(propertyCallbacks, callback);
			if(index > -1){
				propertyCallbacks.splice(index, 1);
			}
		};
		return handle; //Object
	}

});

});

},
'dojo/when':function(){
define([
	"./Deferred",
	"./promise/Promise"
], function(Deferred, Promise){
	"use strict";

	// module:
	//		dojo/when

	return function when(valueOrPromise, callback, errback, progback){
		// summary:
		//		Transparently applies callbacks to values and/or promises.
		// description:
		//		Accepts promises but also transparently handles non-promises. If no
		//		callbacks are provided returns a promise, regardless of the initial
		//		value. Foreign promises are converted.
		//
		//		If callbacks are provided and the initial value is not a promise,
		//		the callback is executed immediately with no error handling. Returns
		//		a promise if the initial value is a promise, or the result of the
		//		callback otherwise.
		// valueOrPromise:
		//		Either a regular value or an object with a `then()` method that
		//		follows the Promises/A specification.
		// callback: Function?
		//		Callback to be invoked when the promise is resolved, or a non-promise
		//		is received.
		// errback: Function?
		//		Callback to be invoked when the promise is rejected.
		// progback: Function?
		//		Callback to be invoked when the promise emits a progress update.
		// returns: dojo/promise/Promise
		//		Promise, or if a callback is provided, the result of the callback.

		var receivedPromise = valueOrPromise && typeof valueOrPromise.then === "function";
		var nativePromise = receivedPromise && valueOrPromise instanceof Promise;

		if(!receivedPromise){
			if(callback){
				return callback(valueOrPromise);
			}else{
				return new Deferred().resolve(valueOrPromise);
			}
		}else if(!nativePromise){
			var deferred = new Deferred(valueOrPromise.cancel);
			valueOrPromise.then(deferred.resolve, deferred.reject, deferred.progress);
			valueOrPromise = deferred.promise;
		}

		if(callback || errback || progback){
			return valueOrPromise.then(callback, errback, progback);
		}
		return valueOrPromise;
	};
});

},
'dojo/Deferred':function(){
define("dojo/Deferred", [
	"./has",
	"./_base/lang",
	"./errors/CancelError",
	"./promise/Promise",
	"./promise/instrumentation"
], function(has, lang, CancelError, Promise, instrumentation){
	"use strict";

	// module:
	//		dojo/Deferred

	var PROGRESS = 0,
			RESOLVED = 1,
			REJECTED = 2;
	var FULFILLED_ERROR_MESSAGE = "This deferred has already been fulfilled.";

	var freezeObject = Object.freeze || function(){};

	var signalWaiting = function(waiting, type, result, rejection, deferred){
		if( 1 ){
			if(type === REJECTED && Deferred.instrumentRejected && waiting.length === 0){
				Deferred.instrumentRejected(result, false, rejection, deferred);
			}
		}

		for(var i = 0; i < waiting.length; i++){
			signalListener(waiting[i], type, result, rejection);
		}
	};

	var signalListener = function(listener, type, result, rejection){
		var func = listener[type];
		var deferred = listener.deferred;
		if(func){
			try{
				var newResult = func(result);
				if(type === PROGRESS){
					if(typeof newResult !== "undefined"){
						signalDeferred(deferred, type, newResult);
					}
				}else{
					if(newResult && typeof newResult.then === "function"){
						listener.cancel = newResult.cancel;
						newResult.then(
								// Only make resolvers if they're actually going to be used
								makeDeferredSignaler(deferred, RESOLVED),
								makeDeferredSignaler(deferred, REJECTED),
								makeDeferredSignaler(deferred, PROGRESS));
						return;
					}
					signalDeferred(deferred, RESOLVED, newResult);
				}
			}catch(error){
				signalDeferred(deferred, REJECTED, error);
			}
		}else{
			signalDeferred(deferred, type, result);
		}

		if( 1 ){
			if(type === REJECTED && Deferred.instrumentRejected){
				Deferred.instrumentRejected(result, !!func, rejection, deferred.promise);
			}
		}
	};

	var makeDeferredSignaler = function(deferred, type){
		return function(value){
			signalDeferred(deferred, type, value);
		};
	};

	var signalDeferred = function(deferred, type, result){
		if(!deferred.isCanceled()){
			switch(type){
				case PROGRESS:
					deferred.progress(result);
					break;
				case RESOLVED:
					deferred.resolve(result);
					break;
				case REJECTED:
					deferred.reject(result);
					break;
			}
		}
	};

	var Deferred = function(canceler){
		// summary:
		//		Creates a new deferred. This API is preferred over
		//		`dojo/_base/Deferred`.
		// description:
		//		Creates a new deferred, as an abstraction over (primarily)
		//		asynchronous operations. The deferred is the private interface
		//		that should not be returned to calling code. That's what the
		//		`promise` is for. See `dojo/promise/Promise`.
		// canceler: Function?
		//		Will be invoked if the deferred is canceled. The canceler
		//		receives the reason the deferred was canceled as its argument.
		//		The deferred is rejected with its return value, or a new
		//		`dojo/errors/CancelError` instance.

		// promise: dojo/promise/Promise
		//		The public promise object that clients can add callbacks to. 
		var promise = this.promise = new Promise();

		var deferred = this;
		var fulfilled, result, rejection;
		var canceled = false;
		var waiting = [];

		if( 1  && Error.captureStackTrace){
			Error.captureStackTrace(deferred, Deferred);
			Error.captureStackTrace(promise, Deferred);
		}

		this.isResolved = promise.isResolved = function(){
			// summary:
			//		Checks whether the deferred has been resolved.
			// returns: Boolean

			return fulfilled === RESOLVED;
		};

		this.isRejected = promise.isRejected = function(){
			// summary:
			//		Checks whether the deferred has been rejected.
			// returns: Boolean

			return fulfilled === REJECTED;
		};

		this.isFulfilled = promise.isFulfilled = function(){
			// summary:
			//		Checks whether the deferred has been resolved or rejected.
			// returns: Boolean

			return !!fulfilled;
		};

		this.isCanceled = promise.isCanceled = function(){
			// summary:
			//		Checks whether the deferred has been canceled.
			// returns: Boolean

			return canceled;
		};

		this.progress = function(update, strict){
			// summary:
			//		Emit a progress update on the deferred.
			// description:
			//		Emit a progress update on the deferred. Progress updates
			//		can be used to communicate updates about the asynchronous
			//		operation before it has finished.
			// update: any
			//		The progress update. Passed to progbacks.
			// strict: Boolean?
			//		If strict, will throw an error if the deferred has already
			//		been fulfilled and consequently no progress can be emitted.
			// returns: dojo/promise/Promise
			//		Returns the original promise for the deferred.

			if(!fulfilled){
				signalWaiting(waiting, PROGRESS, update, null, deferred);
				return promise;
			}else if(strict === true){
				throw new Error(FULFILLED_ERROR_MESSAGE);
			}else{
				return promise;
			}
		};

		this.resolve = function(value, strict){
			// summary:
			//		Resolve the deferred.
			// description:
			//		Resolve the deferred, putting it in a success state.
			// value: any
			//		The result of the deferred. Passed to callbacks.
			// strict: Boolean?
			//		If strict, will throw an error if the deferred has already
			//		been fulfilled and consequently cannot be resolved.
			// returns: dojo/promise/Promise
			//		Returns the original promise for the deferred.

			if(!fulfilled){
				// Set fulfilled, store value. After signaling waiting listeners unset
				// waiting.
				signalWaiting(waiting, fulfilled = RESOLVED, result = value, null, deferred);
				waiting = null;
				return promise;
			}else if(strict === true){
				throw new Error(FULFILLED_ERROR_MESSAGE);
			}else{
				return promise;
			}
		};

		var reject = this.reject = function(error, strict){
			// summary:
			//		Reject the deferred.
			// description:
			//		Reject the deferred, putting it in an error state.
			// error: any
			//		The error result of the deferred. Passed to errbacks.
			// strict: Boolean?
			//		If strict, will throw an error if the deferred has already
			//		been fulfilled and consequently cannot be rejected.
			// returns: dojo/promise/Promise
			//		Returns the original promise for the deferred.

			if(!fulfilled){
				if( 1  && Error.captureStackTrace){
					Error.captureStackTrace(rejection = {}, reject);
				}
				signalWaiting(waiting, fulfilled = REJECTED, result = error, rejection, deferred);
				waiting = null;
				return promise;
			}else if(strict === true){
				throw new Error(FULFILLED_ERROR_MESSAGE);
			}else{
				return promise;
			}
		};

		this.then = promise.then = function(callback, errback, progback){
			// summary:
			//		Add new callbacks to the deferred.
			// description:
			//		Add new callbacks to the deferred. Callbacks can be added
			//		before or after the deferred is fulfilled.
			// callback: Function?
			//		Callback to be invoked when the promise is resolved.
			//		Receives the resolution value.
			// errback: Function?
			//		Callback to be invoked when the promise is rejected.
			//		Receives the rejection error.
			// progback: Function?
			//		Callback to be invoked when the promise emits a progress
			//		update. Receives the progress update.
			// returns: dojo/promise/Promise
			//		Returns a new promise for the result of the callback(s).
			//		This can be used for chaining many asynchronous operations.

			var listener = [progback, callback, errback];
			// Ensure we cancel the promise we're waiting for, or if callback/errback
			// have returned a promise, cancel that one.
			listener.cancel = promise.cancel;
			listener.deferred = new Deferred(function(reason){
				// Check whether cancel is really available, returned promises are not
				// required to expose `cancel`
				return listener.cancel && listener.cancel(reason);
			});
			if(fulfilled && !waiting){
				signalListener(listener, fulfilled, result, rejection);
			}else{
				waiting.push(listener);
			}
			return listener.deferred.promise;
		};

		this.cancel = promise.cancel = function(reason, strict){
			// summary:
			//		Inform the deferred it may cancel its asynchronous operation.
			// description:
			//		Inform the deferred it may cancel its asynchronous operation.
			//		The deferred's (optional) canceler is invoked and the
			//		deferred will be left in a rejected state. Can affect other
			//		promises that originate with the same deferred.
			// reason: any
			//		A message that may be sent to the deferred's canceler,
			//		explaining why it's being canceled.
			// strict: Boolean?
			//		If strict, will throw an error if the deferred has already
			//		been fulfilled and consequently cannot be canceled.
			// returns: any
			//		Returns the rejection reason if the deferred was canceled
			//		normally.

			if(!fulfilled){
				// Cancel can be called even after the deferred is fulfilled
				if(canceler){
					var returnedReason = canceler(reason);
					reason = typeof returnedReason === "undefined" ? reason : returnedReason;
				}
				canceled = true;
				if(!fulfilled){
					// Allow canceler to provide its own reason, but fall back to a CancelError
					if(typeof reason === "undefined"){
						reason = new CancelError();
					}
					reject(reason);
					return reason;
				}else if(fulfilled === REJECTED && result === reason){
					return reason;
				}
			}else if(strict === true){
				throw new Error(FULFILLED_ERROR_MESSAGE);
			}
		};

		freezeObject(promise);
	};

	Deferred.prototype.toString = function(){
		// returns: String
		//		Returns `[object Deferred]`.

		return "[object Deferred]";
	};

	if(instrumentation){
		instrumentation(Deferred);
	}

	return Deferred;
});

},
'dojo/errors/CancelError':function(){
define(["./create"], function(create){
	// module:
	//		dojo/errors/CancelError

	/*=====
	return function(){
		// summary:
		//		Default error if a promise is canceled without a reason.
	};
	=====*/

	return create("CancelError", null, null, { dojoType: "cancel" });
});

},
'dojo/errors/create':function(){
define(["../_base/lang"], function(lang){
	return function(name, ctor, base, props){
		base = base || Error;

		var ErrorCtor = function(message){
			if(base === Error){
				if(Error.captureStackTrace){
					Error.captureStackTrace(this, ErrorCtor);
				}

				// Error.call() operates on the returned error
				// object rather than operating on |this|
				var err = Error.call(this, message),
					prop;

				// Copy own properties from err to |this|
				for(prop in err){
					if(err.hasOwnProperty(prop)){
						this[prop] = err[prop];
					}
				}

				// messsage is non-enumerable in ES5
				this.message = message;
				// stack is non-enumerable in at least Firefox
				this.stack = err.stack;
			}else{
				base.apply(this, arguments);
			}
			if(ctor){
				ctor.apply(this, arguments);
			}
		};

		ErrorCtor.prototype = lang.delegate(base.prototype, props);
		ErrorCtor.prototype.name = name;
		ErrorCtor.prototype.constructor = ErrorCtor;

		return ErrorCtor;
	};
});

},
'dojo/promise/Promise':function(){
define([
	"../_base/lang"
], function(lang){
	"use strict";

	// module:
	//		dojo/promise/Promise

	function throwAbstract(){
		throw new TypeError("abstract");
	}

	return lang.extend(function Promise(){
		// summary:
		//		The public interface to a deferred.
		// description:
		//		The public interface to a deferred. All promises in Dojo are
		//		instances of this class.
	}, {
		then: function(callback, errback, progback){
			// summary:
			//		Add new callbacks to the promise.
			// description:
			//		Add new callbacks to the deferred. Callbacks can be added
			//		before or after the deferred is fulfilled.
			// callback: Function?
			//		Callback to be invoked when the promise is resolved.
			//		Receives the resolution value.
			// errback: Function?
			//		Callback to be invoked when the promise is rejected.
			//		Receives the rejection error.
			// progback: Function?
			//		Callback to be invoked when the promise emits a progress
			//		update. Receives the progress update.
			// returns: dojo/promise/Promise
			//		Returns a new promise for the result of the callback(s).
			//		This can be used for chaining many asynchronous operations.

			throwAbstract();
		},

		cancel: function(reason, strict){
			// summary:
			//		Inform the deferred it may cancel its asynchronous operation.
			// description:
			//		Inform the deferred it may cancel its asynchronous operation.
			//		The deferred's (optional) canceler is invoked and the
			//		deferred will be left in a rejected state. Can affect other
			//		promises that originate with the same deferred.
			// reason: any
			//		A message that may be sent to the deferred's canceler,
			//		explaining why it's being canceled.
			// strict: Boolean?
			//		If strict, will throw an error if the deferred has already
			//		been fulfilled and consequently cannot be canceled.
			// returns: any
			//		Returns the rejection reason if the deferred was canceled
			//		normally.

			throwAbstract();
		},

		isResolved: function(){
			// summary:
			//		Checks whether the promise has been resolved.
			// returns: Boolean

			throwAbstract();
		},

		isRejected: function(){
			// summary:
			//		Checks whether the promise has been rejected.
			// returns: Boolean

			throwAbstract();
		},

		isFulfilled: function(){
			// summary:
			//		Checks whether the promise has been resolved or rejected.
			// returns: Boolean

			throwAbstract();
		},

		isCanceled: function(){
			// summary:
			//		Checks whether the promise has been canceled.
			// returns: Boolean

			throwAbstract();
		},

		always: function(callbackOrErrback){
			// summary:
			//		Add a callback to be invoked when the promise is resolved
			//		or rejected.
			// callbackOrErrback: Function?
			//		A function that is used both as a callback and errback.
			// returns: dojo/promise/Promise
			//		Returns a new promise for the result of the callback/errback.

			return this.then(callbackOrErrback, callbackOrErrback);
		},

		otherwise: function(errback){
			// summary:
			//		Add new errbacks to the promise.
			// errback: Function?
			//		Callback to be invoked when the promise is rejected.
			// returns: dojo/promise/Promise
			//		Returns a new promise for the result of the errback.

			return this.then(null, errback);
		},

		trace: function(){
			return this;
		},

		traceRejected: function(){
			return this;
		},

		toString: function(){
			// returns: string
			//		Returns `[object Promise]`.

			return "[object Promise]";
		}
	});
});

},
'dojo/promise/instrumentation':function(){
define([
	"./tracer",
	"../has",
	"../_base/lang",
	"../_base/array"
], function(tracer, has, lang, arrayUtil){
	function logError(error, rejection, deferred){
		var stack = "";
		if(error && error.stack){
			stack += error.stack;
		}
		if(rejection && rejection.stack){
			stack += "\n    ----------------------------------------\n    rejected" + rejection.stack.split("\n").slice(1).join("\n").replace(/^\s+/, " ");
		}
		if(deferred && deferred.stack){
			stack += "\n    ----------------------------------------\n" + deferred.stack;
		}
		console.error(error, stack);
	}

	function reportRejections(error, handled, rejection, deferred){
		if(!handled){
			logError(error, rejection, deferred);
		}
	}

	var errors = [];
	var activeTimeout = false;
	var unhandledWait = 1000;
	function trackUnhandledRejections(error, handled, rejection, deferred){
		if(handled){
			arrayUtil.some(errors, function(obj, ix){
				if(obj.error === error){
					errors.splice(ix, 1);
					return true;
				}
			});
		}else if(!arrayUtil.some(errors, function(obj){ return obj.error === error; })){
			errors.push({
				error: error,
				rejection: rejection,
				deferred: deferred,
				timestamp: new Date().getTime()
			});
		}

		if(!activeTimeout){
			activeTimeout = setTimeout(logRejected, unhandledWait);
		}
	}

	function logRejected(){
		var now = new Date().getTime();
		var reportBefore = now - unhandledWait;
		errors = arrayUtil.filter(errors, function(obj){
			if(obj.timestamp < reportBefore){
				logError(obj.error, obj.rejection, obj.deferred);
				return false;
			}
			return true;
		});

		if(errors.length){
			activeTimeout = setTimeout(logRejected, errors[0].timestamp + unhandledWait - now);
		}else{
			activeTimeout = false;
		}
	}

	return function(Deferred){
		// summary:
		//		Initialize instrumentation for the Deferred class.
		// description:
		//		Initialize instrumentation for the Deferred class.
		//		Done automatically by `dojo/Deferred` if the
		//		`deferredInstrumentation` and `useDeferredInstrumentation`
		//		config options are set.
		//
		//		Sets up `dojo/promise/tracer` to log to the console.
		//
		//		Sets up instrumentation of rejected deferreds so unhandled
		//		errors are logged to the console.

		var usage = has("config-useDeferredInstrumentation");
		if(usage){
			tracer.on("resolved", lang.hitch(console, "log", "resolved"));
			tracer.on("rejected", lang.hitch(console, "log", "rejected"));
			tracer.on("progress", lang.hitch(console, "log", "progress"));

			var args = [];
			if(typeof usage === "string"){
				args = usage.split(",");
				usage = args.shift();
			}
			if(usage === "report-rejections"){
				Deferred.instrumentRejected = reportRejections;
			}else if(usage === "report-unhandled-rejections" || usage === true || usage === 1){
				Deferred.instrumentRejected = trackUnhandledRejections;
				unhandledWait = parseInt(args[0], 10) || unhandledWait;
			}else{
				throw new Error("Unsupported instrumentation usage <" + usage + ">");
			}
		}
	};
});

},
'dojo/promise/tracer':function(){
define([
	"../_base/lang",
	"./Promise",
	"../Evented"
], function(lang, Promise, Evented){
	"use strict";

	// module:
	//		dojo/promise/tracer

	/*=====
	return {
		// summary:
		//		Trace promise fulfillment.
		// description:
		//		Trace promise fulfillment. Calling `.trace()` or `.traceError()` on a
		//		promise enables tracing. Will emit `resolved`, `rejected` or `progress`
		//		events.

		on: function(type, listener){
			// summary:
			//		Subscribe to traces.
			// description:
			//		See `dojo/Evented#on()`.
			// type: String
			//		`resolved`, `rejected`, or `progress`
			// listener: Function
			//		The listener is passed the traced value and any arguments
			//		that were used with the `.trace()` call.
		}
	};
	=====*/

	var evented = new Evented;
	var emit = evented.emit;
	evented.emit = null;
	// Emit events asynchronously since they should not change the promise state.
	function emitAsync(args){
		setTimeout(function(){
			emit.apply(evented, args);
		}, 0);
	}

	Promise.prototype.trace = function(){
		// summary:
		//		Trace the promise.
		// description:
		//		Tracing allows you to transparently log progress,
		//		resolution and rejection of promises, without affecting the
		//		promise itself. Any arguments passed to `trace()` are
		//		emitted in trace events. See `dojo/promise/tracer` on how
		//		to handle traces.
		// returns: dojo/promise/Promise
		//		The promise instance `trace()` is called on.

		var args = lang._toArray(arguments);
		this.then(
			function(value){ emitAsync(["resolved", value].concat(args)); },
			function(error){ emitAsync(["rejected", error].concat(args)); },
			function(update){ emitAsync(["progress", update].concat(args)); }
		);
		return this;
	};

	Promise.prototype.traceRejected = function(){
		// summary:
		//		Trace rejection of the promise.
		// description:
		//		Tracing allows you to transparently log progress,
		//		resolution and rejection of promises, without affecting the
		//		promise itself. Any arguments passed to `trace()` are
		//		emitted in trace events. See `dojo/promise/tracer` on how
		//		to handle traces.
		// returns: dojo/promise/Promise
		//		The promise instance `traceRejected()` is called on.

		var args = lang._toArray(arguments);
		this.otherwise(function(error){
			emitAsync(["rejected", error].concat(args));
		});
		return this;
	};

	return evented;
});

},
'dijit/Destroyable':function(){
define([
	"dojo/_base/array", // array.forEach array.map
	"dojo/aspect",
	"dojo/_base/declare"
], function(array, aspect, declare){

// module:
//		dijit/Destroyable

return declare("dijit.Destroyable", null, {
	// summary:
	//		Mixin to track handles and release them when instance is destroyed.
	// description:
	//		Call this.own(...) on list of handles (returned from dojo/aspect, dojo/on,
	//		dojo/Stateful::watch, or any class (including widgets) with a destroyRecursive() or destroy() method.
	//		Then call destroy() later to destroy this instance and release the resources.

	destroy: function(/*Boolean*/ preserveDom){
		// summary:
		//		Destroy this class, releasing any resources registered via own().
		this._destroyed = true;
	},

	own: function(){
		// summary:
		//		Track specified handles and remove/destroy them when this instance is destroyed, unless they were
		//		already removed/destroyed manually.
		// tags:
		//		protected
		// returns:
		//		The array of specified handles, so you can do for example:
		//	|		var handle = this.own(on(...))[0];

		array.forEach(arguments, function(handle){
			var destroyMethodName =
				"destroyRecursive" in handle ? "destroyRecursive" :	// remove "destroyRecursive" for 2.0
				"destroy" in handle ? "destroy" :
				"remove";

			// When this.destroy() is called, destroy handle.  Since I'm using aspect.before(),
			// the handle will be destroyed before a subclass's destroy() method starts running, before it calls
			// this.inherited() or even if it doesn't call this.inherited() at all.  If that's an issue, make an
			// onDestroy() method and connect to that instead.
			var odh = aspect.before(this, "destroy", function(preserveDom){
				handle[destroyMethodName](preserveDom);
			});

			// If handle is destroyed manually before this.destroy() is called, remove the listener set directly above.
			var hdh = aspect.after(handle, destroyMethodName, function(){
				odh.remove();
				hdh.remove();
			}, true);
		}, this);

		return arguments;		// handle
	}
});

});

},
'dojox/mobile/ProgressIndicator':function(){
define([
	"dojo/_base/config",
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/dom-geometry",
	"dojo/dom-style",
	"dojo/has",
	"dijit/_Contained",
	"dijit/_WidgetBase"
], function(config, declare, lang, domClass, domConstruct, domGeometry, domStyle, has, Contained, WidgetBase){

	// module:
	//		dojox/mobile/ProgressIndicator

	var cls = declare("dojox.mobile.ProgressIndicator", [WidgetBase, Contained], {
		// summary:
		//		A progress indication widget.
		// description:
		//		ProgressIndicator is a round spinning graphical representation
		//		that indicates the current task is ongoing.

		// interval: Number
		//		The time interval in milliseconds for updating the spinning
		//		indicator.
		interval: 100,

		// size: Number
		//		The size of the indicator in pixels.
		size: 40,

		// removeOnStop: Boolean
		//		If true, this widget is removed from the parent node
		//		when stop() is called.
		removeOnStop: true,

		// startSpinning: Boolean
		//		If true, calls start() to run the indicator at startup.
		startSpinning: false,

		// center: Boolean
		//		If true, the indicator is displayed as center aligned.
		center: true,

		// colors: String[]
		//		An array of indicator colors. 12 colors have to be given.
		//		If colors are not specified, CSS styles
		//		(mblProg0Color - mblProg11Color) are used.
		colors: null,

		/* internal properties */
		
		// baseClass: String
		//		The name of the CSS class of this widget.	
		baseClass: "mblProgressIndicator",

		constructor: function(){
			// summary:
			//		Creates a new instance of the class.
			this.colors = [];
			this._bars = [];
		},

		buildRendering: function(){
			this.inherited(arguments);
			if(this.center){
				domClass.add(this.domNode, "mblProgressIndicatorCenter");
			}
			this.containerNode = domConstruct.create("div", {className:"mblProgContainer"}, this.domNode);
			this.spinnerNode = domConstruct.create("div", null, this.containerNode);
			for(var i = 0; i < 12; i++){
				var div = domConstruct.create("div", {className:"mblProg mblProg"+i}, this.spinnerNode);
				this._bars.push(div);
			}
			this.scale(this.size);
			if(this.startSpinning){
				this.start();
			}
		},

		scale: function(/*Number*/size){
			// summary:
			//		Changes the size of the indicator.
			// size:
			//		The size of the indicator in pixels.
			var scale = size / 40;
			domStyle.set(this.containerNode, {
				webkitTransform: "scale(" + scale + ")",
				webkitTransformOrigin: "0 0"
			});
			domGeometry.setMarginBox(this.domNode, {w:size, h:size});
			domGeometry.setMarginBox(this.containerNode, {w:size / scale, h:size / scale});
		},

		start: function(){
			// summary:
			//		Starts the spinning of the ProgressIndicator.
			if(this.imageNode){
				var img = this.imageNode;
				var l = Math.round((this.containerNode.offsetWidth - img.offsetWidth) / 2);
				var t = Math.round((this.containerNode.offsetHeight - img.offsetHeight) / 2);
				img.style.margin = t+"px "+l+"px";
				return;
			}
			var cntr = 0;
			var _this = this;
			var n = 12;
			this.timer = setInterval(function(){
				cntr--;
				cntr = cntr < 0 ? n - 1 : cntr;
				var c = _this.colors;
				for(var i = 0; i < n; i++){
					var idx = (cntr + i) % n;
					if(c[idx]){
						_this._bars[i].style.backgroundColor = c[idx];
					}else{
						domClass.replace(_this._bars[i],
										 "mblProg" + idx + "Color",
										 "mblProg" + (idx === n - 1 ? 0 : idx + 1) + "Color");
					}
				}
			}, this.interval);
		},

		stop: function(){
			// summary:
			//		Stops the spinning of the ProgressIndicator.
			if(this.timer){
				clearInterval(this.timer);
			}
			this.timer = null;
			if(this.removeOnStop && this.domNode && this.domNode.parentNode){
				this.domNode.parentNode.removeChild(this.domNode);
			}
		},

		setImage: function(/*String*/file){
			// summary:
			//		Sets an indicator icon image file (typically animated GIF).
			//		If null is specified, restores the default spinner.
			if(file){
				this.imageNode = domConstruct.create("img", {src:file}, this.containerNode);
				this.spinnerNode.style.display = "none";
			}else{
				if(this.imageNode){
					this.containerNode.removeChild(this.imageNode);
					this.imageNode = null;
				}
				this.spinnerNode.style.display = "";
			}
		},

		destroy: function(){
			this.inherited(arguments);
			if(this === cls._instance){
				cls._instance = null;
			}
		}
	});

	cls._instance = null;
	cls.getInstance = function(props){
		if(!cls._instance){
			cls._instance = new cls(props);
		}
		return cls._instance;
	};

	return cls;
});

},
'dojox/mobile/ToolBarButton':function(){
define([
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/window",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/dom-style",
	"./sniff",
	"./_ItemBase"
], function(declare, lang, win, domClass, domConstruct, domStyle, has, ItemBase){

	// module:
	//		dojox/mobile/ToolBarButton

	return declare("dojox.mobile.ToolBarButton", ItemBase, {
		// summary:
		//		A button widget which is placed in the Heading widget.
		// description:
		//		ToolBarButton is a button which is typically placed in the
		//		Heading widget. It is a subclass of dojox/mobile/_ItemBase just
		//		like ListItem or IconItem. So, unlike Button, it has basically
		//		the same capability as ListItem or IconItem, such as icon
		//		support, transition, etc.

		// selected: Boolean
		//		If true, the button is in the selected state.
		selected: false,

		// arrow: String
		//		Specifies "right" or "left" to be an arrow button.
		arrow: "",

		// light: Boolean
		//		If true, this widget produces only a single `<span>` node when it
		//		has only an icon or only a label, and has no arrow. In that
		//		case, you cannot have both icon and label, or arrow even if you
		//		try to set them.
		light: true,

		// defaultColor: String
		//		CSS class for the default color.
		//		Note: If this button has an arrow (typically back buttons on iOS),
		//		the class selector used for it is the value of defaultColor + "45".
		//		For example, by default the arrow selector is "mblColorDefault45".
		defaultColor: "mblColorDefault",

		// selColor: String
		//		CSS class for the selected color.
		//		Note: If this button has an arrow (typically back buttons on iOS),
		//		the class selector used for it is the value of selColor + "45".
		//		For example, by default the selected arrow selector is "mblColorDefaultSel45".
		selColor: "mblColorDefaultSel",

		/* internal properties */
		baseClass: "mblToolBarButton",

		_selStartMethod: "touch",
		_selEndMethod: "touch",

		buildRendering: function(){
			if(!this.label && this.srcNodeRef){
				this.label = this.srcNodeRef.innerHTML;
			}
			this.label = lang.trim(this.label);
			this.domNode = (this.srcNodeRef && this.srcNodeRef.tagName === "SPAN") ?
				this.srcNodeRef : domConstruct.create("span");
			this.inherited(arguments);

			if(this.light && !this.arrow && (!this.icon || !this.label)){
				this.labelNode = this.tableNode = this.bodyNode = this.iconParentNode = this.domNode;
				domClass.add(this.domNode, this.defaultColor + " mblToolBarButtonBody" +
							 (this.icon ? " mblToolBarButtonLightIcon" : " mblToolBarButtonLightText"));
				return;
			}

			this.domNode.innerHTML = "";
			if(this.arrow === "left" || this.arrow === "right"){
				this.arrowNode = domConstruct.create("span", {
					className: "mblToolBarButtonArrow mblToolBarButton" +
					(this.arrow === "left" ? "Left" : "Right") + "Arrow " +
					(has("ie") ? "" : (this.defaultColor + " " + this.defaultColor + "45"))
				}, this.domNode);
				domClass.add(this.domNode, "mblToolBarButtonHas" +
					(this.arrow === "left" ? "Left" : "Right") + "Arrow");
			}
			this.bodyNode = domConstruct.create("span", {className:"mblToolBarButtonBody"}, this.domNode);
			this.tableNode = domConstruct.create("table", {cellPadding:"0",cellSpacing:"0",border:"0"}, this.bodyNode);

			var row = this.tableNode.insertRow(-1);
			this.iconParentNode = row.insertCell(-1);
			this.labelNode = row.insertCell(-1);
			this.iconParentNode.className = "mblToolBarButtonIcon";
			this.labelNode.className = "mblToolBarButtonLabel";

			if(this.icon && this.icon !== "none" && this.label){
				domClass.add(this.domNode, "mblToolBarButtonHasIcon");
				domClass.add(this.bodyNode, "mblToolBarButtonLabeledIcon");
			}

			domClass.add(this.bodyNode, this.defaultColor);
		},

		startup: function(){
			if(this._started){ return; }

			this._keydownHandle = this.connect(this.domNode, "onkeydown", "_onClick"); // for desktop browsers

			this.inherited(arguments);
			if(!this._isOnLine){
				this._isOnLine = true;
				// retry applying the attribute for which the custom setter delays the actual 
				// work until _isOnLine is true. 
				this.set("icon", this._pendingIcon !== undefined ? this._pendingIcon : this.icon);
				// Not needed anymore (this code executes only once per life cycle):
				delete this._pendingIcon; 
			}
		},

		_onClick: function(e){
			// summary:
			//		Internal handler for click events.
			// tags:
			//		private
			if(e && e.type === "keydown" && e.keyCode !== 13){ return; }
			if(this.onClick(e) === false){ return; } // user's click action
			this.defaultClickAction(e);
		},

		onClick: function(/*Event*/ /*===== e =====*/){
			// summary:
			//		User defined function to handle clicks
			// tags:
			//		callback
		},

		_setLabelAttr: function(/*String*/text){
			// summary:
			//		Sets the button label text.
			this.inherited(arguments);
			domClass.toggle(this.tableNode, "mblToolBarButtonText", text);
		},

		_setSelectedAttr: function(/*Boolean*/selected){
			// summary:
			//		Makes this widget in the selected or unselected state.
			var replace = function(node, a, b){
				domClass.replace(node, a + " " + a + "45", b + " " + b + "45");
			}
			this.inherited(arguments);
			if(selected){
				domClass.replace(this.bodyNode, this.selColor, this.defaultColor);
				if(!has("ie") && this.arrowNode){
					replace(this.arrowNode, this.selColor, this.defaultColor);
				}
			}else{
				domClass.replace(this.bodyNode, this.defaultColor, this.selColor);
				if(!has("ie") && this.arrowNode){
					replace(this.arrowNode, this.defaultColor, this.selColor);
				}
			}
			domClass.toggle(this.domNode, "mblToolBarButtonSelected", selected);
			domClass.toggle(this.bodyNode, "mblToolBarButtonBodySelected", selected);
		}
	});
});

},
'dojox/mobile/sniff':function(){
define([
	"dojo/_base/window",
	"dojo/_base/sniff"
], function(win, has){

	var ua = navigator.userAgent;

	// BlackBerry (OS 6 or later only)
	has.add('bb', (ua.indexOf("BlackBerry") >= 0 || ua.indexOf("BB10")) && parseFloat(ua.split("Version/")[1]) || undefined, undefined, true);

	// Android
	has.add('android', parseFloat(ua.split("Android ")[1]) || undefined, undefined, true);

	// iPhone, iPod, or iPad
	// If iPod or iPad is detected, in addition to has('ipod') or has('ipad'),
	// has('iphone') will also have iOS version number.
	if(ua.match(/(iPhone|iPod|iPad)/)){
		var p = RegExp.$1.replace(/P/, 'p');
		var v = ua.match(/OS ([\d_]+)/) ? RegExp.$1 : "1";
		var os = parseFloat(v.replace(/_/, '.').replace(/_/g, ''));
		has.add(p, os, undefined, true);
		has.add('iphone', os, undefined, true);
	}

	if(has("webkit")){
		has.add('touch', (typeof win.doc.documentElement.ontouchstart != "undefined" &&
			navigator.appVersion.indexOf("Mobile") != -1) || !!has('android'), undefined, true);
	}

	/*=====
	return {
		// summary:
		//		This module sets has() flags based on the userAgent of the current browser.
	};
	=====*/
	return has;
});

},
'dojox/mobile/_ItemBase':function(){
define([
	"dojo/_base/array",
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/window",
	"dojo/dom-class",
	"dojo/touch",
	"dijit/registry",
	"dijit/_Contained",
	"dijit/_Container",
	"dijit/_WidgetBase",
	"./TransitionEvent",
	"./iconUtils",
	"./sniff"
], function(array, declare, lang, win, domClass, touch, registry, Contained, Container, WidgetBase, TransitionEvent, iconUtils, has){

	// module:
	//		dojox/mobile/_ItemBase

	return declare("dojox.mobile._ItemBase", [WidgetBase, Container, Contained],{
		// summary:
		//		A base class for item classes (e.g. ListItem, IconItem, etc.).
		// description:
		//		_ItemBase is a base class for widgets that have capability to
		//		make a view transition when clicked.

		// icon: String
		//		An icon image to display. The value can be either a path for an
		//		image file or a class name of a DOM button. If icon is not
		//		specified, the iconBase parameter of the parent widget is used.
		icon: "",

		// iconPos: String
		//		The position of an aggregated icon. IconPos is comma separated
		//		values like top,left,width,height (ex. "0,0,29,29"). If iconPos
		//		is not specified, the iconPos parameter of the parent widget is
		//		used.
		iconPos: "", // top,left,width,height (ex. "0,0,29,29")

		// alt: String
		//		An alternate text for the icon image.
		alt: "",

		// href: String
		//		A URL of another web page to go to.
		href: "",

		// hrefTarget: String
		//		A target that specifies where to open a page specified by
		//		href. The value will be passed to the 2nd argument of
		//		window.open().
		hrefTarget: "",

		// moveTo: String
		//		The id of the transition destination view which resides in the
		//		current page.
		//
		//		If the value has a hash sign ('#') before the id (e.g. #view1)
		//		and the dojo/hash module is loaded by the user application, the
		//		view transition updates the hash in the browser URL so that the
		//		user can bookmark the destination view. In this case, the user
		//		can also use the browser's back/forward button to navigate
		//		through the views in the browser history.
		//
		//		If null, transitions to a blank view.
		//		If '#', returns immediately without transition.
		moveTo: "",

		// scene: String
		//		The name of a scene. Used from dojox/mobile/app.
		scene: "",

		// clickable: Boolean
		//		If true, this item becomes clickable even if a transition
		//		destination (moveTo, etc.) is not specified.
		clickable: false,

		// url: String
		//		A URL of an html fragment page or JSON data that represents a
		//		new view content. The view content is loaded with XHR and
		//		inserted in the current page. Then a view transition occurs to
		//		the newly created view. The view is cached so that subsequent
		//		requests would not load the content again.
		url: "",

		// urlTarget: String
		//		Node id under which a new view will be created according to the
		//		url parameter. If not specified, The new view will be created as
		//		a sibling of the current view.
		urlTarget: "",

		// back: Boolean
		//		If true, history.back() is called when clicked.
		back: false,

		// transition: String
		//		A type of animated transition effect. You can choose from the
		//		standard transition types, "slide", "fade", "flip", or from the
		//		extended transition types, "cover", "coverv", "dissolve",
		//		"reveal", "revealv", "scaleIn", "scaleOut", "slidev",
		//		"swirl", "zoomIn", "zoomOut", "cube", and "swap". If "none" is
		//		specified, transition occurs immediately without animation.
		transition: "",

		// transitionDir: Number
		//		The transition direction. If 1, transition forward. If -1,
		//		transition backward. For example, the slide transition slides
		//		the view from right to left when dir == 1, and from left to
		//		right when dir == -1.
		transitionDir: 1,

		// transitionOptions: Object
		//		A hash object that holds transition options.
		transitionOptions: null,

		// callback: Function|String
		//		A callback function that is called when the transition has been
		//		finished. A function reference, or name of a function in
		//		context.
		callback: null,

		// label: String
		//		A label of the item. If the label is not specified, innerHTML is
		//		used as a label.
		label: "",

		// toggle: Boolean
		//		If true, the item acts like a toggle button.
		toggle: false,

		// selected: Boolean
		//		If true, the item is highlighted to indicate it is selected.
		selected: false,

		// tabIndex: String
		//		Tabindex setting for the item so users can hit the tab key to
		//		focus on it.
		tabIndex: "0",
		
		// _setTabIndexAttr: [private] String
		//		Sets tabIndex to domNode.
		_setTabIndexAttr: "",

		/* internal properties */	

		// paramsToInherit: String
		//		Comma separated parameters to inherit from the parent.
		paramsToInherit: "transition,icon",

		// _selStartMethod: String
		//		Specifies how the item enters the selected state.
		//
		//		- "touch": Use touch events to enter the selected state.
		//		- "none": Do not change the selected state.
		_selStartMethod: "none", // touch or none

		// _selEndMethod: String
		//		Specifies how the item leaves the selected state.
		//
		//		- "touch": Use touch events to leave the selected state.
		//		- "timer": Use setTimeout to leave the selected state.
		//		- "none": Do not change the selected state.
		_selEndMethod: "none", // touch, timer, or none

		// _delayedSelection: Boolean
		//		If true, selection is delayed 100ms and canceled if dragged in
		//		order to avoid selection when flick operation is performed.
		_delayedSelection: false,

		// _duration: Number
		//		Duration of selection, milliseconds.
		_duration: 800,

		// _handleClick: Boolean
		//		If true, this widget listens to touch events.
		_handleClick: true,

		buildRendering: function(){
			this.inherited(arguments);
			this._isOnLine = this.inheritParams();
		},

		startup: function(){
			if(this._started){ return; }
			if(!this._isOnLine){
				this.inheritParams();
			}
			if(this._handleClick && this._selStartMethod === "touch"){
				this._onTouchStartHandle = this.connect(this.domNode, touch.press, "_onTouchStart");
			}
			this.inherited(arguments);
		},

		inheritParams: function(){
			// summary:
			//		Copies from the parent the values of parameters specified 
			//		by the property paramsToInherit.
			var parent = this.getParent();
			if(parent){
				array.forEach(this.paramsToInherit.split(/,/), function(p){
					if(p.match(/icon/i)){
						var base = p + "Base", pos = p + "Pos";
						if(this[p] && parent[base] &&
							parent[base].charAt(parent[base].length - 1) === '/'){
							this[p] = parent[base] + this[p];
						}
						if(!this[p]){ this[p] = parent[base]; }
						if(!this[pos]){ this[pos] = parent[pos]; }
					}
					if(!this[p]){ this[p] = parent[p]; }
				}, this);
			}
			return !!parent;
		},

		getTransOpts: function(){
			// summary:
			//		Copies from the parent and returns the values of parameters  
			//		specified by the property paramsToInherit.
			var opts = this.transitionOptions || {};
			array.forEach(["moveTo", "href", "hrefTarget", "url", "target",
				"urlTarget", "scene", "transition", "transitionDir"], function(p){
				opts[p] = opts[p] || this[p];
			}, this);
			return opts; // Object
		},

		userClickAction: function(/*Event*/ /*===== e =====*/){
			// summary:
			//		User-defined click action.
		},

		defaultClickAction: function(/*Event*/e){
			// summary:
			//		The default action of this item.
			this.handleSelection(e);
			if(this.userClickAction(e) === false){ return; } // user's click action
			this.makeTransition(e);
		},

		handleSelection: function(/*Event*/e){
			// summary:
			//		Handles this items selection state.

			// Before transitioning, we want the visual effect of selecting the item.
			// To ensure this effect happens even if _delayedSelection is true:
			if(this._delayedSelection){
			  this.set("selected", true);
			} // the item will be deselected after transition.

			if(this._onTouchEndHandle){
				this.disconnect(this._onTouchEndHandle);
				this._onTouchEndHandle = null;
			}

			var p = this.getParent();
			if(this.toggle){
				this.set("selected", !this._currentSel);
			}else if(p && p.selectOne){
				this.set("selected", true);
			}else{
				if(this._selEndMethod === "touch"){
					this.set("selected", false);
				}else if(this._selEndMethod === "timer"){
					var _this = this;
					this.defer(function(){
						_this.set("selected", false);
					}, this._duration);
				}
			}
		},

		makeTransition: function(/*Event*/e){
			// summary:
			//		Makes a transition.
			if(this.back && history){
				history.back();	
				return;
			}	
			if (this.href && this.hrefTarget) {
				win.global.open(this.href, this.hrefTarget || "_blank");
				this._onNewWindowOpened(e);
				return;
			}
			var opts = this.getTransOpts();
			var doTransition = 
				!!(opts.moveTo || opts.href || opts.url || opts.target || opts.scene);
			if(this._prepareForTransition(e, doTransition ? opts : null) === false){ return; }
			if(doTransition){
				this.setTransitionPos(e);
				new TransitionEvent(this.domNode, opts, e).dispatch();
			}
		},

		_onNewWindowOpened: function(/*Event*/ /*===== e =====*/){
			// summary:
			//		Subclasses may want to implement it.
		},

		_prepareForTransition: function(/*Event*/e, /*Object*/transOpts){
			// summary:
			//		Subclasses may want to implement it.
		},
		
		_onTouchStart: function(e){
			// tags:
			//		private
			if(this.getParent().isEditing || this.onTouchStart(e) === false){ return; } // user's touchStart action
			if(!this._onTouchEndHandle && this._selStartMethod === "touch"){
				// Connect to the entire window. Otherwise, fail to receive
				// events if operation is performed outside this widget.
				// Expose both connect handlers in case the user has interest.
				this._onTouchMoveHandle = this.connect(win.body(), touch.move, "_onTouchMove");
				this._onTouchEndHandle = this.connect(win.body(), touch.release, "_onTouchEnd");
			}
			this.touchStartX = e.touches ? e.touches[0].pageX : e.clientX;
			this.touchStartY = e.touches ? e.touches[0].pageY : e.clientY;
			this._currentSel = this.selected;

			if(this._delayedSelection){
				// so as not to make selection when the user flicks on ScrollableView
				this._selTimer = setTimeout(lang.hitch(this, function(){ this.set("selected", true); }), 100);
			}else{
				this.set("selected", true);
			}
		},

		onTouchStart: function(/*Event*/ /*===== e =====*/){
			// summary:
			//		User-defined function to handle touchStart events.
			// tags:
			//		callback
		},

		_onTouchMove: function(e){
			// tags:
			//		private
			var x = e.touches ? e.touches[0].pageX : e.clientX;
			var y = e.touches ? e.touches[0].pageY : e.clientY;
			if(Math.abs(x - this.touchStartX) >= 4 ||
			   Math.abs(y - this.touchStartY) >= 4){ // dojox/mobile/scrollable.threshold
				this.cancel();
				var p = this.getParent();
				if(p && p.selectOne){
					this._prevSel && this._prevSel.set("selected", true);
				}else{
					this.set("selected", false);
				}
			}
		},

		_disconnect: function(){
			// tags:
			//		private
			this.disconnect(this._onTouchMoveHandle);
			this.disconnect(this._onTouchEndHandle);
			this._onTouchMoveHandle = this._onTouchEndHandle = null;
		},

		cancel: function(){
			// summary:
			//		Cancels an ongoing selection (if any).
			if(this._selTimer){
				clearTimeout(this._selTimer);
				this._selTimer = null;
			}
			this._disconnect();
		},

		_onTouchEnd: function(e){
			// tags:
			//		private
			if(!this._selTimer && this._delayedSelection){ return; }
			this.cancel();
			this._onClick(e);
		},

		setTransitionPos: function(e){
			// summary:
			//		Stores the clicked position for later use.
			// description:
			//		Some of the transition animations (e.g. ScaleIn) need the
			//		clicked position.
			var w = this;
			while(true){
				w = w.getParent();
				if(!w || domClass.contains(w.domNode, "mblView")){ break; }
			}
			if(w){
				w.clickedPosX = e.clientX;
				w.clickedPosY = e.clientY;
			}
		},

		transitionTo: function(/*String|Object*/moveTo, /*String*/href, /*String*/url, /*String*/scene){
			// summary:
			//		Performs a view transition.
			// description:
			//		Given a transition destination, this method performs a view
			//		transition. This method is typically called when this item
			//		is clicked.
			var opts = (moveTo && typeof(moveTo) === "object") ? moveTo :
				{moveTo: moveTo, href: href, url: url, scene: scene,
				 transition: this.transition, transitionDir: this.transitionDir};
			new TransitionEvent(this.domNode, opts).dispatch();
		},

		_setIconAttr: function(icon){
			// tags:
			//		private
			if(!this._isOnLine){
				// record the value to be able to reapply it (see the code in the startup method)
				this._pendingIcon = icon;  
				return; 
			} // icon may be invalid because inheritParams is not called yet
			this._set("icon", icon);
			this.iconNode = iconUtils.setIcon(icon, this.iconPos, this.iconNode, this.alt, this.iconParentNode, this.refNode, this.position);
		},

		_setLabelAttr: function(/*String*/text){
			// tags:
			//		private
			this._set("label", text);
			this.labelNode.innerHTML = this._cv ? this._cv(text) : text;
		},

		_setSelectedAttr: function(/*Boolean*/selected){
			// summary:
			//		Makes this widget in the selected or unselected state.
			// description:
			//		Subclass should override.
			// tags:
			//		private
			if(selected){
				var p = this.getParent();
				if(p && p.selectOne){
					// deselect the currently selected item
					var arr = array.filter(p.getChildren(), function(w){
						return w.selected;
					});
					array.forEach(arr, function(c){
						this._prevSel = c;
						c.set("selected", false);
					}, this);
				}
			}
			this._set("selected", selected);
		}
	});
});

},
'dojo/touch':function(){
define(["./_base/kernel", "./aspect", "./dom", "./on", "./has", "./mouse", "./ready", "./_base/window"],
function(dojo, aspect, dom, on, has, mouse, ready, win){

	// module:
	//		dojo/touch

	var hasTouch = has("touch");

	// TODO: get iOS version from dojo/sniff after #15827 is fixed
	var ios4 = false;
	if(has("ios")){
		var ua = navigator.userAgent;
		var v = ua.match(/OS ([\d_]+)/) ? RegExp.$1 : "1";
		var os = parseFloat(v.replace(/_/, '.').replace(/_/g, ''));
		ios4 = os < 5;
	}

	var touchmove, hoveredNode;

	if(hasTouch){
		ready(function(){
			// Keep track of currently hovered node
			hoveredNode = win.body();	// currently hovered node

			win.doc.addEventListener("touchstart", function(evt){
				// Precede touchstart event with touch.over event.  DnD depends on this.
				// Use addEventListener(cb, true) to run cb before any touchstart handlers on node run,
				// and to ensure this code runs even if the listener on the node does event.stop().
				var oldNode = hoveredNode;
				hoveredNode = evt.target;
				on.emit(oldNode, "dojotouchout", {
					target: oldNode,
					relatedTarget: hoveredNode,
					bubbles: true
				});
				on.emit(hoveredNode, "dojotouchover", {
					target: hoveredNode,
					relatedTarget: oldNode,
					bubbles: true
				});
			}, true);

			// Fire synthetic touchover and touchout events on nodes since the browser won't do it natively.
			on(win.doc, "touchmove", function(evt){
				var newNode = win.doc.elementFromPoint(
					evt.pageX - (ios4 ? 0 : win.global.pageXOffset), // iOS 4 expects page coords
					evt.pageY - (ios4 ? 0 : win.global.pageYOffset)
				);
				if(newNode && hoveredNode !== newNode){
					// touch out on the old node
					on.emit(hoveredNode, "dojotouchout", {
						target: hoveredNode,
						relatedTarget: newNode,
						bubbles: true
					});

					// touchover on the new node
					on.emit(newNode, "dojotouchover", {
						target: newNode,
						relatedTarget: hoveredNode,
						bubbles: true
					});

					hoveredNode = newNode;
				}
			});
		});

		// Define synthetic touch.move event that unlike the native touchmove, fires for the node the finger is
		// currently dragging over rather than the node where the touch started.
		touchmove = function(node, listener){
			return on(win.doc, "touchmove", function(evt){
				if(node === win.doc || dom.isDescendant(hoveredNode, node)){
					evt.target = hoveredNode;
					listener.call(this, evt);
				}
			});
		};
	}


	function _handle(type){
		// type: String
		//		press | move | release | cancel

		return function(node, listener){//called by on(), see dojo.on
			return on(node, type, listener);
		};
	}

	//device neutral events - touch.press|move|release|cancel/over/out
	var touch = {
		press: _handle(hasTouch ? "touchstart": "mousedown"),
		move: hasTouch ? touchmove :_handle("mousemove"),
		release: _handle(hasTouch ? "touchend": "mouseup"),
		cancel: hasTouch ? _handle("touchcancel") : mouse.leave,
		over: _handle(hasTouch ? "dojotouchover": "mouseover"),
		out: _handle(hasTouch ? "dojotouchout": "mouseout"),
		enter: mouse._eventHandler(hasTouch ? "dojotouchover" : "mouseover"),
		leave: mouse._eventHandler(hasTouch ? "dojotouchout" : "mouseout")
	};
	/*=====
	touch = {
		// summary:
		//		This module provides unified touch event handlers by exporting
		//		press, move, release and cancel which can also run well on desktop.
		//		Based on http://dvcs.w3.org/hg/webevents/raw-file/tip/touchevents.html
		//
		// example:
		//		Used with dojo.on
		//		|	define(["dojo/on", "dojo/touch"], function(on, touch){
		//		|		on(node, touch.press, function(e){});
		//		|		on(node, touch.move, function(e){});
		//		|		on(node, touch.release, function(e){});
		//		|		on(node, touch.cancel, function(e){});
		// example:
		//		Used with touch.* directly
		//		|	touch.press(node, function(e){});
		//		|	touch.move(node, function(e){});
		//		|	touch.release(node, function(e){});
		//		|	touch.cancel(node, function(e){});

		press: function(node, listener){
			// summary:
			//		Register a listener to 'touchstart'|'mousedown' for the given node
			// node: Dom
			//		Target node to listen to
			// listener: Function
			//		Callback function
			// returns:
			//		A handle which will be used to remove the listener by handle.remove()
		},
		move: function(node, listener){
			// summary:
			//		Register a listener to 'touchmove'|'mousemove' for the given node
			// node: Dom
			//		Target node to listen to
			// listener: Function
			//		Callback function
			// returns:
			//		A handle which will be used to remove the listener by handle.remove()
		},
		release: function(node, listener){
			// summary:
			//		Register a listener to 'touchend'|'mouseup' for the given node
			// node: Dom
			//		Target node to listen to
			// listener: Function
			//		Callback function
			// returns:
			//		A handle which will be used to remove the listener by handle.remove()
		},
		cancel: function(node, listener){
			// summary:
			//		Register a listener to 'touchcancel'|'mouseleave' for the given node
			// node: Dom
			//		Target node to listen to
			// listener: Function
			//		Callback function
			// returns:
			//		A handle which will be used to remove the listener by handle.remove()
		},
		over: function(node, listener){
			// summary:
			//		Register a listener to 'mouseover' or touch equivalent for the given node
			// node: Dom
			//		Target node to listen to
			// listener: Function
			//		Callback function
			// returns:
			//		A handle which will be used to remove the listener by handle.remove()
		},
		out: function(node, listener){
			// summary:
			//		Register a listener to 'mouseout' or touch equivalent for the given node
			// node: Dom
			//		Target node to listen to
			// listener: Function
			//		Callback function
			// returns:
			//		A handle which will be used to remove the listener by handle.remove()
		},
		enter: function(node, listener){
			// summary:
			//		Register a listener to mouse.enter or touch equivalent for the given node
			// node: Dom
			//		Target node to listen to
			// listener: Function
			//		Callback function
			// returns:
			//		A handle which will be used to remove the listener by handle.remove()
		},
		leave: function(node, listener){
			// summary:
			//		Register a listener to mouse.leave or touch equivalent for the given node
			// node: Dom
			//		Target node to listen to
			// listener: Function
			//		Callback function
			// returns:
			//		A handle which will be used to remove the listener by handle.remove()
		}
	};
	=====*/

	 1  && (dojo.touch = touch);

	return touch;
});

},
'dojox/mobile/TransitionEvent':function(){
define([
	"dojo/_base/declare",
	"dojo/_base/Deferred",
	"dojo/_base/lang",
	"dojo/on",
	"./transition"
], function(declare, Deferred, lang, on, transitDeferred){

	return declare("dojox.mobile.TransitionEvent", null, {
		// summary:
		//		A class used to trigger view transitions.
		
		constructor: function(/*DomNode*/target, /*Object*/transitionOptions, /*Event?*/triggerEvent){
			// summary:
			//		Creates a transition event.
			// target:
			//		The DOM node that initiates the transition (for example a ListItem).
			// transitionOptions:
			//		Contains the transition options.
			// triggerEvent:
			//		The event that triggered the transition (for example a touch event on a ListItem).
			this.transitionOptions=transitionOptions;	
			this.target = target;
			this.triggerEvent=triggerEvent||null;	
		},

		dispatch: function(){
			// summary:
			//		Dispatches this transition event. Emits a "startTransition" event on the target.
			var opts = {bubbles:true, cancelable:true, detail: this.transitionOptions, triggerEvent: this.triggerEvent};	
			//0 && console.log("Target: ", this.target, " opts: ", opts);

			var evt = on.emit(this.target,"startTransition", opts);
			//0 && console.log('evt: ', evt);
			if(evt){
				Deferred.when(transitDeferred, lang.hitch(this, function(transition){
					Deferred.when(transition.call(this, evt), lang.hitch(this, function(results){
						this.endTransition(results);
					})); 
				}));
			}
		},

		endTransition: function(results){
			// summary:
			//		Called when the transition ends. Emits a "endTransition" event on the target.
			on.emit(this.target, "endTransition" , {detail: results.transitionOptions});
		}
	});
});

},
'dojo/_base/Deferred':function(){
define([
	"./kernel",
	"../Deferred",
	"../promise/Promise",
	"../errors/CancelError",
	"../has",
	"./lang",
	"../when"
], function(dojo, NewDeferred, Promise, CancelError, has, lang, when){
	// module:
	//		dojo/_base/Deferred

	var mutator = function(){};
	var freeze = Object.freeze || function(){};
	// A deferred provides an API for creating and resolving a promise.
	var Deferred = dojo.Deferred = function(/*Function?*/ canceller){
		// summary:
		//		Deprecated.   This module defines the legacy dojo/_base/Deferred API.
		//		New code should use dojo/Deferred instead.
		// description:
		//		The Deferred API is based on the concept of promises that provide a
		//		generic interface into the eventual completion of an asynchronous action.
		//		The motivation for promises fundamentally is about creating a
		//		separation of concerns that allows one to achieve the same type of
		//		call patterns and logical data flow in asynchronous code as can be
		//		achieved in synchronous code. Promises allows one
		//		to be able to call a function purely with arguments needed for
		//		execution, without conflating the call with concerns of whether it is
		//		sync or async. One shouldn't need to alter a call's arguments if the
		//		implementation switches from sync to async (or vice versa). By having
		//		async functions return promises, the concerns of making the call are
		//		separated from the concerns of asynchronous interaction (which are
		//		handled by the promise).
		//
		//		The Deferred is a type of promise that provides methods for fulfilling the
		//		promise with a successful result or an error. The most important method for
		//		working with Dojo's promises is the then() method, which follows the
		//		CommonJS proposed promise API. An example of using a Dojo promise:
		//
		//		|	var resultingPromise = someAsyncOperation.then(function(result){
		//		|		... handle result ...
		//		|	},
		//		|	function(error){
		//		|		... handle error ...
		//		|	});
		//
		//		The .then() call returns a new promise that represents the result of the
		//		execution of the callback. The callbacks will never affect the original promises value.
		//
		//		The Deferred instances also provide the following functions for backwards compatibility:
		//
		//		- addCallback(handler)
		//		- addErrback(handler)
		//		- callback(result)
		//		- errback(result)
		//
		//		Callbacks are allowed to return promises themselves, so
		//		you can build complicated sequences of events with ease.
		//
		//		The creator of the Deferred may specify a canceller.  The canceller
		//		is a function that will be called if Deferred.cancel is called
		//		before the Deferred fires. You can use this to implement clean
		//		aborting of an XMLHttpRequest, etc. Note that cancel will fire the
		//		deferred with a CancelledError (unless your canceller returns
		//		another kind of error), so the errbacks should be prepared to
		//		handle that error for cancellable Deferreds.
		// example:
		//	|	var deferred = new Deferred();
		//	|	setTimeout(function(){ deferred.callback({success: true}); }, 1000);
		//	|	return deferred;
		// example:
		//		Deferred objects are often used when making code asynchronous. It
		//		may be easiest to write functions in a synchronous manner and then
		//		split code using a deferred to trigger a response to a long-lived
		//		operation. For example, instead of register a callback function to
		//		denote when a rendering operation completes, the function can
		//		simply return a deferred:
		//
		//		|	// callback style:
		//		|	function renderLotsOfData(data, callback){
		//		|		var success = false
		//		|		try{
		//		|			for(var x in data){
		//		|				renderDataitem(data[x]);
		//		|			}
		//		|			success = true;
		//		|		}catch(e){ }
		//		|		if(callback){
		//		|			callback(success);
		//		|		}
		//		|	}
		//
		//		|	// using callback style
		//		|	renderLotsOfData(someDataObj, function(success){
		//		|		// handles success or failure
		//		|		if(!success){
		//		|			promptUserToRecover();
		//		|		}
		//		|	});
		//		|	// NOTE: no way to add another callback here!!
		// example:
		//		Using a Deferred doesn't simplify the sending code any, but it
		//		provides a standard interface for callers and senders alike,
		//		providing both with a simple way to service multiple callbacks for
		//		an operation and freeing both sides from worrying about details
		//		such as "did this get called already?". With Deferreds, new
		//		callbacks can be added at any time.
		//
		//		|	// Deferred style:
		//		|	function renderLotsOfData(data){
		//		|		var d = new Deferred();
		//		|		try{
		//		|			for(var x in data){
		//		|				renderDataitem(data[x]);
		//		|			}
		//		|			d.callback(true);
		//		|		}catch(e){
		//		|			d.errback(new Error("rendering failed"));
		//		|		}
		//		|		return d;
		//		|	}
		//
		//		|	// using Deferred style
		//		|	renderLotsOfData(someDataObj).then(null, function(){
		//		|		promptUserToRecover();
		//		|	});
		//		|	// NOTE: addErrback and addCallback both return the Deferred
		//		|	// again, so we could chain adding callbacks or save the
		//		|	// deferred for later should we need to be notified again.
		// example:
		//		In this example, renderLotsOfData is synchronous and so both
		//		versions are pretty artificial. Putting the data display on a
		//		timeout helps show why Deferreds rock:
		//
		//		|	// Deferred style and async func
		//		|	function renderLotsOfData(data){
		//		|		var d = new Deferred();
		//		|		setTimeout(function(){
		//		|			try{
		//		|				for(var x in data){
		//		|					renderDataitem(data[x]);
		//		|				}
		//		|				d.callback(true);
		//		|			}catch(e){
		//		|				d.errback(new Error("rendering failed"));
		//		|			}
		//		|		}, 100);
		//		|		return d;
		//		|	}
		//
		//		|	// using Deferred style
		//		|	renderLotsOfData(someDataObj).then(null, function(){
		//		|		promptUserToRecover();
		//		|	});
		//
		//		Note that the caller doesn't have to change his code at all to
		//		handle the asynchronous case.

		var result, finished, isError, head, nextListener;
		var promise = (this.promise = new Promise());

		function complete(value){
			if(finished){
				throw new Error("This deferred has already been resolved");
			}
			result = value;
			finished = true;
			notify();
		}
		function notify(){
			var mutated;
			while(!mutated && nextListener){
				var listener = nextListener;
				nextListener = nextListener.next;
				if((mutated = (listener.progress == mutator))){ // assignment and check
					finished = false;
				}

				var func = (isError ? listener.error : listener.resolved);
				if(has("config-useDeferredInstrumentation")){
					if(isError && NewDeferred.instrumentRejected){
						NewDeferred.instrumentRejected(result, !!func);
					}
				}
				if(func){
					try{
						var newResult = func(result);
						if (newResult && typeof newResult.then === "function"){
							newResult.then(lang.hitch(listener.deferred, "resolve"), lang.hitch(listener.deferred, "reject"), lang.hitch(listener.deferred, "progress"));
							continue;
						}
						var unchanged = mutated && newResult === undefined;
						if(mutated && !unchanged){
							isError = newResult instanceof Error;
						}
						listener.deferred[unchanged && isError ? "reject" : "resolve"](unchanged ? result : newResult);
					}catch(e){
						listener.deferred.reject(e);
					}
				}else{
					if(isError){
						listener.deferred.reject(result);
					}else{
						listener.deferred.resolve(result);
					}
				}
			}
		}
		// calling resolve will resolve the promise
		this.resolve = this.callback = function(value){
			// summary:
			//		Fulfills the Deferred instance successfully with the provide value
			this.fired = 0;
			this.results = [value, null];
			complete(value);
		};


		// calling error will indicate that the promise failed
		this.reject = this.errback = function(error){
			// summary:
			//		Fulfills the Deferred instance as an error with the provided error
			isError = true;
			this.fired = 1;
			if(has("config-useDeferredInstrumentation")){
				if(NewDeferred.instrumentRejected){
					NewDeferred.instrumentRejected(error, !!nextListener);
				}
			}
			complete(error);
			this.results = [null, error];
		};
		// call progress to provide updates on the progress on the completion of the promise
		this.progress = function(update){
			// summary:
			//		Send progress events to all listeners
			var listener = nextListener;
			while(listener){
				var progress = listener.progress;
				progress && progress(update);
				listener = listener.next;
			}
		};
		this.addCallbacks = function(callback, errback){
			// summary:
			//		Adds callback and error callback for this deferred instance.
			// callback: Function?
			//		The callback attached to this deferred object.
			// errback: Function?
			//		The error callback attached to this deferred object.
			// returns:
			//		Returns this deferred object.
			this.then(callback, errback, mutator);
			return this;	// Deferred
		};
		// provide the implementation of the promise
		promise.then = this.then = function(/*Function?*/resolvedCallback, /*Function?*/errorCallback, /*Function?*/progressCallback){
			// summary:
			//		Adds a fulfilledHandler, errorHandler, and progressHandler to be called for
			//		completion of a promise. The fulfilledHandler is called when the promise
			//		is fulfilled. The errorHandler is called when a promise fails. The
			//		progressHandler is called for progress events. All arguments are optional
			//		and non-function values are ignored. The progressHandler is not only an
			//		optional argument, but progress events are purely optional. Promise
			//		providers are not required to ever create progress events.
			//
			//		This function will return a new promise that is fulfilled when the given
			//		fulfilledHandler or errorHandler callback is finished. This allows promise
			//		operations to be chained together. The value returned from the callback
			//		handler is the fulfillment value for the returned promise. If the callback
			//		throws an error, the returned promise will be moved to failed state.
			//
			// returns:
			//		Returns a new promise that represents the result of the
			//		execution of the callback. The callbacks will never affect the original promises value.
			// example:
			//		An example of using a CommonJS compliant promise:
			//		|	asyncComputeTheAnswerToEverything().
			//		|		then(addTwo).
			//		|		then(printResult, onError);
			//		|	>44
			//
			var returnDeferred = progressCallback == mutator ? this : new Deferred(promise.cancel);
			var listener = {
				resolved: resolvedCallback,
				error: errorCallback,
				progress: progressCallback,
				deferred: returnDeferred
			};
			if(nextListener){
				head = head.next = listener;
			}
			else{
				nextListener = head = listener;
			}
			if(finished){
				notify();
			}
			return returnDeferred.promise; // Promise
		};
		var deferred = this;
		promise.cancel = this.cancel = function(){
			// summary:
			//		Cancels the asynchronous operation
			if(!finished){
				var error = canceller && canceller(deferred);
				if(!finished){
					if (!(error instanceof Error)){
						error = new CancelError(error);
					}
					error.log = false;
					deferred.reject(error);
				}
			}
		};
		freeze(promise);
	};
	lang.extend(Deferred, {
		addCallback: function(/*Function*/ callback){
			// summary:
			//		Adds successful callback for this deferred instance.
			// returns:
			//		Returns this deferred object.
			return this.addCallbacks(lang.hitch.apply(dojo, arguments));	// Deferred
		},

		addErrback: function(/*Function*/ errback){
			// summary:
			//		Adds error callback for this deferred instance.
			// returns:
			//		Returns this deferred object.
			return this.addCallbacks(null, lang.hitch.apply(dojo, arguments));	// Deferred
		},

		addBoth: function(/*Function*/ callback){
			// summary:
			//		Add handler as both successful callback and error callback for this deferred instance.
			// returns:
			//		Returns this deferred object.
			var enclosed = lang.hitch.apply(dojo, arguments);
			return this.addCallbacks(enclosed, enclosed);	// Deferred
		},
		fired: -1
	});

	Deferred.when = dojo.when = when;

	return Deferred;
});

},
'dojox/mobile/transition':function(){
define([
	"dojo/_base/Deferred",
	"dojo/_base/config"
], function(Deferred, config){
	/*=====
	return {
		// summary:
		//		This is the wrapper module which loads
		//		dojox/css3/transit conditionally. If mblCSS3Transition
		//		is set to 'dojox/css3/transit', it will be loaded as
		//		the module to conduct view transitions, otherwise this module returns null.
	};
	=====*/
	if(config['mblCSS3Transition']){
		//require dojox/css3/transit and resolve it as the result of transitDeferred.
		var transitDeferred = new Deferred();
		require([config['mblCSS3Transition']], function(transit){
			transitDeferred.resolve(transit);
		});
		return transitDeferred;
	}
	return null;
});

},
'dojox/mobile/iconUtils':function(){
define([
	"dojo/_base/array",
	"dojo/_base/config",
	"dojo/_base/connect",
	"dojo/_base/event",
	"dojo/_base/lang",
	"dojo/_base/window",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/dom-style",
	"./sniff"
], function(array, config, connect, event, lang, win, domClass, domConstruct, domStyle, has){

	var dm = lang.getObject("dojox.mobile", true);

	// module:
	//		dojox/mobile/iconUtils

	var IconUtils = function(){
		// summary:
		//		Utilities to create an icon (image, CSS sprite image, or DOM Button).

		this.setupSpriteIcon = function(/*DomNode*/iconNode, /*String*/iconPos){
			// summary:
			//		Sets up CSS sprite for a foreground image.
			if(iconNode && iconPos){
				var arr = array.map(iconPos.split(/[ ,]/),function(item){return item-0});
				var t = arr[0]; // top
				var r = arr[1] + arr[2]; // right
				var b = arr[0] + arr[3]; // bottom
				var l = arr[1]; // left
				domStyle.set(iconNode, {
					clip: "rect("+t+"px "+r+"px "+b+"px "+l+"px)",
					top: (iconNode.parentNode ? domStyle.get(iconNode, "top") : 0) - t + "px",
					left: -l + "px"
				});
				domClass.add(iconNode, "mblSpriteIcon");
			}
		};

		this.createDomButton = function(/*DomNode*/refNode, /*Object?*/style, /*DomNode?*/toNode){
			// summary:
			//		Creates a DOM button.
			// description:
			//		DOM button is a simple graphical object that consists of one or
			//		more nested DIV elements with some CSS styling. It can be used
			//		in place of an icon image on ListItem, IconItem, and so on.
			//		The kind of DOM button to create is given as a class name of
			//		refNode. The number of DIVs to create is searched from the style
			//		sheets in the page. However, if the class name has a suffix that
			//		starts with an underscore, like mblDomButtonGoldStar_5, then the
			//		suffixed number is used instead. A class name for DOM button
			//		must starts with 'mblDomButton'.
			// refNode:
			//		A node that has a DOM button class name.
			// style:
			//		A hash object to set styles to the node.
			// toNode:
			//		A root node to create a DOM button. If omitted, refNode is used.

			if(!this._domButtons){
				if(has("webkit")){
					var findDomButtons = function(sheet, dic){
						// summary:
						//		Searches the style sheets for DOM buttons.
						// description:
						//		Returns a key-value pair object whose keys are DOM
						//		button class names and values are the number of DOM
						//		elements they need.
						var i, j;
						if(!sheet){
							var _dic = {};
							var ss = win.doc.styleSheets;
							for (i = 0; i < ss.length; i++){
								ss[i] && findDomButtons(ss[i], _dic);
							}
							return _dic;
						}
						var rules = sheet.cssRules || [];
						for (i = 0; i < rules.length; i++){
							var rule = rules[i];
							if(rule.href && rule.styleSheet){
								findDomButtons(rule.styleSheet, dic);
							}else if(rule.selectorText){
								var sels = rule.selectorText.split(/,/);
								for (j = 0; j < sels.length; j++){
									var sel = sels[j];
									var n = sel.split(/>/).length - 1;
									if(sel.match(/(mblDomButton\w+)/)){
										var cls = RegExp.$1;
										if(!dic[cls] || n > dic[cls]){
											dic[cls] = n;
										}
									}
								}
							}
						}
						return dic;
					}
					this._domButtons = findDomButtons();
				}else{
					this._domButtons = {};
				}
			}

			var s = refNode.className;
			var node = toNode || refNode;
			if(s.match(/(mblDomButton\w+)/) && s.indexOf("/") === -1){
				var btnClass = RegExp.$1;
				var nDiv = 4;
				if(s.match(/(mblDomButton\w+_(\d+))/)){
					nDiv = RegExp.$2 - 0;
				}else if(this._domButtons[btnClass] !== undefined){
					nDiv = this._domButtons[btnClass];
				}
				var props = null;
				if(has("bb") && config["mblBBBoxShadowWorkaround"] !== false){
					// Removes box-shadow because BlackBerry incorrectly renders it.
					props = {style:"-webkit-box-shadow:none"};
				}
				for(var i = 0, p = node; i < nDiv; i++){
					p = p.firstChild || domConstruct.create("div", props, p);
				}
				if(toNode){
					setTimeout(function(){
						domClass.remove(refNode, btnClass);
					}, 0);
					domClass.add(toNode, btnClass);
				}
			}else if(s.indexOf(".") !== -1){ // file name
				domConstruct.create("img", {src:s}, node);
			}else{
				return null;
			}
			domClass.add(node, "mblDomButton");
			!!style && domStyle.set(node, style);
			return node;
		};

		this.createIcon = function(/*String*/icon, /*String?*/iconPos, /*DomNode?*/node, /*String?*/title, /*DomNode?*/parent, /*DomNode?*/refNode, /*String?*/pos){
			// summary:
			//		Creates or updates an icon node
			// description:
			//		If node exists, updates the existing node. Otherwise, creates a new one.
			// icon:
			//		Path for an image, or DOM button class name.
			title = title || "";
			if(icon && icon.indexOf("mblDomButton") === 0){
				// DOM button
				if(!node){
					node = domConstruct.create("div", null, refNode || parent, pos);
				}else{
					if(node.className.match(/(mblDomButton\w+)/)){
						domClass.remove(node, RegExp.$1);
					}
				}
				node.title = title;
				domClass.add(node, icon);
				this.createDomButton(node);
			}else if(icon && icon !== "none"){
				// Image
				if(!node || node.nodeName !== "IMG"){
					node = domConstruct.create("img", {
						alt: title
					}, refNode || parent, pos);
				}
				node.src = (icon || "").replace("${theme}", dm.currentTheme);
				this.setupSpriteIcon(node, iconPos);
				if(iconPos && parent){
					var arr = iconPos.split(/[ ,]/);
					domStyle.set(parent, {
						width: arr[2] + "px",
						height: arr[3] + "px"
					});
					domClass.add(parent, "mblSpriteIconParent");
				}
				connect.connect(node, "ondragstart", event, "stop");
			}
			return node;
		};

		this.iconWrapper = false;
		this.setIcon = function(/*String*/icon, /*String*/iconPos, /*DomNode*/iconNode, /*String?*/alt, /*DomNode*/parent, /*DomNode?*/refNode, /*String?*/pos){
			// summary:
			//		A setter function to set an icon.
			// description:
			//		This function is intended to be used by icon setters (e.g. _setIconAttr)
			// icon:
			//		An icon path or a DOM button class name.
			// iconPos:
			//		The position of an aggregated icon. IconPos is comma separated
			//		values like top,left,width,height (ex. "0,0,29,29").
			// iconNode:
			//		An icon node.
			// alt:
			//		An alt text for the icon image.
			// parent:
			//		Parent node of the icon.
			// refNode:
			//		A node reference to place the icon.
			// pos:
			//		The position of the icon relative to refNode.
			if(!parent || !icon && !iconNode){ return null; }
			if(icon && icon !== "none"){ // create or update an icon
				if(!this.iconWrapper && icon.indexOf("mblDomButton") !== 0 && !iconPos){ // image
					if(iconNode && iconNode.tagName === "DIV"){
						domConstruct.destroy(iconNode);
						iconNode = null;
					}
					iconNode = this.createIcon(icon, null, iconNode, alt, parent, refNode, pos);
					domClass.add(iconNode, "mblImageIcon");
				}else{ // sprite or DOM button
					if(iconNode && iconNode.tagName === "IMG"){
						domConstruct.destroy(iconNode);
						iconNode = null;
					}
					iconNode && domConstruct.empty(iconNode);
					if(!iconNode){
						iconNode = domConstruct.create("div", null, refNode || parent, pos);
					}
					this.createIcon(icon, iconPos, null, null, iconNode);
					if(alt){
						iconNode.title = alt;
					}
				}
				domClass.remove(parent, "mblNoIcon");
				return iconNode;
			}else{ // clear the icon
				domConstruct.destroy(iconNode);
				domClass.add(parent, "mblNoIcon");
				return null;
			}
		};
	};

	// Return singleton.  (TODO: can we replace IconUtils class and singleton w/a simple hash of functions?)
	return new IconUtils();
});

},
'dojox/mobile/View':function(){
define([
	"dojo/_base/array",
	"dojo/_base/config",
	"dojo/_base/connect",
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/sniff",
	"dojo/_base/window",
	"dojo/_base/Deferred",
	"dojo/dom",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/dom-geometry",
	"dojo/dom-style",
	"dijit/registry",
	"dijit/_Contained",
	"dijit/_Container",
	"dijit/_WidgetBase",
	"./ViewController", // to load ViewController for you (no direct references)
	"./common",
	"./transition",
	"./viewRegistry"
], function(array, config, connect, declare, lang, has, win, Deferred, dom, domClass, domConstruct, domGeometry, domStyle, registry, Contained, Container, WidgetBase, ViewController, common, transitDeferred, viewRegistry){

	// module:
	//		dojox/mobile/View

	var dm = lang.getObject("dojox.mobile", true);

	return declare("dojox.mobile.View", [WidgetBase, Container, Contained], {
		// summary:
		//		A widget that represents a view that occupies the full screen
		// description:
		//		View acts as a container for any HTML and/or widgets. An entire
		//		HTML page can have multiple View widgets and the user can
		//		navigate through the views back and forth without page
		//		transitions.

		// selected: Boolean
		//		If true, the view is displayed at startup time.
		selected: false,

		// keepScrollPos: Boolean
		//		If true, the scroll position is kept when transition occurs between views.
		keepScrollPos: true,

		// tag: String
		//		A name of the HTML tag to create as domNode.
		tag: "div",

		/* internal properties */
		baseClass: "mblView",

		constructor: function(/*Object*/params, /*DomNode?*/node){
			// summary:
			//		Creates a new instance of the class.
			// params:
			//		Contains the parameters.
			// node:
			//		The DOM node. If none is specified, it is automatically created. 
			if(node){
				dom.byId(node).style.visibility = "hidden";
			}
		},

		destroy: function(){
			viewRegistry.remove(this.id);
			this.inherited(arguments);
		},

		buildRendering: function(){
			this.domNode = this.containerNode = this.srcNodeRef || domConstruct.create(this.tag);

			this._animEndHandle = this.connect(this.domNode, "webkitAnimationEnd", "onAnimationEnd");
			this._animStartHandle = this.connect(this.domNode, "webkitAnimationStart", "onAnimationStart");
			if(!config['mblCSS3Transition']){
				this._transEndHandle = this.connect(this.domNode, "webkitTransitionEnd", "onAnimationEnd");
			}
			if(has('mblAndroid3Workaround')){
				// workaround for the screen flicker issue on Android 3.x/4.0
				// applying "-webkit-transform-style:preserve-3d" to domNode can avoid
				// transition animation flicker
				domStyle.set(this.domNode, "webkitTransformStyle", "preserve-3d");
			}

			viewRegistry.add(this);
			this.inherited(arguments);
		},

		startup: function(){
			if(this._started){ return; }

			// Determine which view among the siblings should be visible.
			// Priority:
			//	 1. fragment id in the url (ex. #view1,view2)
			//	 2. this.selected
			//	 3. the first view
			if(this._visible === undefined){
				var views = this.getSiblingViews();
				var ids = location.hash && location.hash.substring(1).split(/,/);
				var fragView, selectedView, firstView;
				array.forEach(views, function(v, i){
					if(array.indexOf(ids, v.id) !== -1){ fragView = v; }
					if(i == 0){ firstView = v; }
					if(v.selected){ selectedView = v; }
					v._visible = false;
				}, this);
				(fragView || selectedView || firstView)._visible = true;
			}
			if(this._visible){
				// The 2nd arg is not to hide its sibling views so that they can be
				// correctly initialized.
				this.show(true, true);

				// Defer firing events to let user connect to events just after creation
				// TODO: revisit this for 2.0
				this.defer(function(){
					this.onStartView();
					connect.publish("/dojox/mobile/startView", [this]);
				});
			}

			if(this.domNode.style.visibility != "visible"){ // this check is to avoid screen flickers
				this.domNode.style.visibility = "visible";
			}

			// Need to call inherited first - so that child widgets get started
			// up correctly
			this.inherited(arguments);

			var parent = this.getParent();
			if(!parent || !parent.resize){ // top level widget
				this.resize();
			}

			if(!this._visible){
				// hide() should be called last so that child widgets can be
				// initialized while they are visible.
				this.hide();
			}
		},

		resize: function(){
			// summary:
			//		Calls resize() of each child widget.
			array.forEach(this.getChildren(), function(child){
				if(child.resize){ child.resize(); }
			});
		},

		onStartView: function(){
			// summary:
			//		Stub function to connect to from your application.
			// description:
			//		Called only when this view is shown at startup time.
		},

		onBeforeTransitionIn: function(moveTo, dir, transition, context, method){
			// summary:
			//		Stub function to connect to from your application.
			// description:
			//		Called before the arriving transition occurs.
		},

		onAfterTransitionIn: function(moveTo, dir, transition, context, method){
			// summary:
			//		Stub function to connect to from your application.
			// description:
			//		Called after the arriving transition occurs.
		},

		onBeforeTransitionOut: function(moveTo, dir, transition, context, method){
			// summary:
			//		Stub function to connect to from your application.
			// description:
			//		Called before the leaving transition occurs.
		},

		onAfterTransitionOut: function(moveTo, dir, transition, context, method){
			// summary:
			//		Stub function to connect to from your application.
			// description:
			//		Called after the leaving transition occurs.
		},

		_clearClasses: function(/*DomNode*/node){
			// summary:
			//		Clean up the domNode classes that were added while making a transition.
			// description:
			//		Remove all the "mbl" prefixed classes except mbl*View.
			if(!node){ return; }
			var classes = [];
			array.forEach(lang.trim(node.className||"").split(/\s+/), function(c){
				if(c.match(/^mbl\w*View$/) || c.indexOf("mbl") === -1){
					classes.push(c);
				}
			}, this);
			node.className = classes.join(' ');
		},

		_fixViewState: function(/*DomNode*/toNode){
			// summary:
			//		Sanity check for view transition states.
			// description:
			//		Sometimes uninitialization of Views fails after making view transition,
			//		and that results in failure of subsequent view transitions.
			//		This function does the uninitialization for all the sibling views.
			var nodes = this.domNode.parentNode.childNodes;
			for(var i = 0; i < nodes.length; i++){
				var n = nodes[i];
				if(n.nodeType === 1 && domClass.contains(n, "mblView")){
					this._clearClasses(n);
				}
			}
			this._clearClasses(toNode); // just in case toNode is a sibling of an ancestor.
		},

		convertToId: function(moveTo){
			if(typeof(moveTo) == "string"){
				// removes a leading hash mark (#) and params if exists
				// ex. "#bar&myParam=0003" -> "bar"
				return moveTo.replace(/^#?([^&?]+).*/, "$1");
			}
			return moveTo;
		},

		_isBookmarkable: function(detail){
			return detail.moveTo && (config['mblForceBookmarkable'] || detail.moveTo.charAt(0) === '#') && !detail.hashchange;
		},

		performTransition: function(/*String*/moveTo, /*Number*/transitionDir, /*String*/transition,
									/*Object|null*/context, /*String|Function*/method /*...*/){
			// summary:
			//		Function to perform the various types of view transitions, such as fade, slide, and flip.
			// moveTo: String
			//		The id of the transition destination view which resides in
			//		the current page.
			//		If the value has a hash sign ('#') before the id
			//		(e.g. #view1) and the dojo/hash module is loaded by the user
			//		application, the view transition updates the hash in the
			//		browser URL so that the user can bookmark the destination
			//		view. In this case, the user can also use the browser's
			//		back/forward button to navigate through the views in the
			//		browser history.
			//		If null, transitions to a blank view.
			//		If '#', returns immediately without transition.
			// transitionDir: Number
			//		The transition direction. If 1, transition forward. If -1, transition backward.
			//		For example, the slide transition slides the view from right to left when transitionDir == 1,
			//		and from left to right when transitionDir == -1.
			// transition: String
			//		A type of animated transition effect. You can choose from
			//		the standard transition types, "slide", "fade", "flip", or
			//		from the extended transition types, "cover", "coverv",
			//		"dissolve", "reveal", "revealv", "scaleIn", "scaleOut",
			//		"slidev", "swirl", "zoomIn", "zoomOut", "cube", and
			//		"swap". If "none" is specified, transition occurs
			//		immediately without animation.
			// context: Object
			//		The object that the callback function will receive as "this".
			// method: String|Function
			//		A callback function that is called when the transition has finished.
			//		A function reference, or name of a function in context.
			// tags:
			//		public
			//
			// example:
			//		Transition backward to a view whose id is "foo" with the slide animation.
			//	|	performTransition("foo", -1, "slide");
			//
			// example:
			//		Transition forward to a blank view, and then open another page.
			//	|	performTransition(null, 1, "slide", null, function(){location.href = href;});

			if(this._detail){ return; } // transition is in progress
			
			// normalize the arg
			var detail, optArgs;
			if(moveTo && typeof(moveTo) === "object"){
				detail = moveTo;
				optArgs = transitionDir; // array
			}else{
				detail = {
					moveTo: moveTo,
					transitionDir: transitionDir,
					transition: transition,
					context: context,
					method: method
				};
				optArgs = [];
				for(var i = 5; i < arguments.length; i++){
					optArgs.push(arguments[i]);
				}
			}

			// save the parameters
			this._detail = detail;
			this._optArgs = optArgs;
			this._arguments = [
				detail.moveTo,
				detail.transitionDir,
				detail.transition,
				detail.context,
				detail.method
			];

			if(detail.moveTo === "#"){ return; }
			var toNode;
			if(detail.moveTo){
				toNode = this.convertToId(detail.moveTo);
			}else{
				if(!this._dummyNode){
					this._dummyNode = win.doc.createElement("div");
					win.body().appendChild(this._dummyNode);
				}
				toNode = this._dummyNode;
			}

			if(this.addTransitionInfo && typeof(detail.moveTo) == "string" && this._isBookmarkable(detail)){
				this.addTransitionInfo(this.id, detail.moveTo, {transitionDir:detail.transitionDir, transition:detail.transition});
			}

			var fromNode = this.domNode;
			var fromTop = fromNode.offsetTop;
			toNode = this.toNode = dom.byId(toNode);
			if(!toNode){ 0 && console.log("dojox/mobile/View.performTransition: destination view not found: "+detail.moveTo); return; }
			toNode.style.visibility = "hidden";
			toNode.style.display = "";
			this._fixViewState(toNode);
			var toWidget = registry.byNode(toNode);
			if(toWidget){
				// Now that the target view became visible, it's time to run resize()
				if(config["mblAlwaysResizeOnTransition"] || !toWidget._resized){
					common.resizeAll(null, toWidget);
					toWidget._resized = true;
				}

				if(detail.transition && detail.transition != "none"){
					// Temporarily add padding to align with the fromNode while transition
					toWidget.containerNode.style.paddingTop = fromTop + "px";
				}

				toWidget.load && toWidget.load(); // for ContentView

				toWidget.movedFrom = fromNode.id;
			}
			if(has('mblAndroidWorkaround') && !config['mblCSS3Transition']
					&& detail.transition && detail.transition != "none"){
				// workaround for the screen flicker issue on Android 2.2/2.3
				// apply "-webkit-transform-style:preserve-3d" to both toNode and fromNode
				// to make them 3d-transition-ready state just before transition animation
				domStyle.set(toNode, "webkitTransformStyle", "preserve-3d");
				domStyle.set(fromNode, "webkitTransformStyle", "preserve-3d");
				// show toNode offscreen to avoid flicker when switching "display" and "visibility" styles
				domClass.add(toNode, "mblAndroidWorkaround");
			}

			this.onBeforeTransitionOut.apply(this, this._arguments);
			connect.publish("/dojox/mobile/beforeTransitionOut", [this].concat(lang._toArray(this._arguments)));
			if(toWidget){
				// perform view transition keeping the scroll position
				if(this.keepScrollPos && !this.getParent()){
					var scrollTop = win.body().scrollTop || win.doc.documentElement.scrollTop || win.global.pageYOffset || 0;
					fromNode._scrollTop = scrollTop;
					var toTop = (detail.transitionDir == 1) ? 0 : (toNode._scrollTop || 0);
					toNode.style.top = "0px";
					if(scrollTop > 1 || toTop !== 0){
						fromNode.style.top = toTop - scrollTop + "px";
						if(config["mblHideAddressBar"] !== false){
							setTimeout(function(){ // iPhone needs setTimeout
								win.global.scrollTo(0, (toTop || 1));
							}, 0);
						}
					}
				}else{
					toNode.style.top = "0px";
				}
				toWidget.onBeforeTransitionIn.apply(toWidget, this._arguments);
				connect.publish("/dojox/mobile/beforeTransitionIn", [toWidget].concat(lang._toArray(this._arguments)));
			}
			toNode.style.display = "none";
			toNode.style.visibility = "visible";

			common.fromView = this;
			common.toView = toWidget;

			this._doTransition(fromNode, toNode, detail.transition, detail.transitionDir);
		},

		_toCls: function(s){
			// convert from transition name to corresponding class name
			// ex. "slide" -> "mblSlide"
			return "mbl"+s.charAt(0).toUpperCase() + s.substring(1);
		},

		_doTransition: function(fromNode, toNode, transition, transitionDir){
			var rev = (transitionDir == -1) ? " mblReverse" : "";
			toNode.style.display = "";
			if(!transition || transition == "none"){
				this.domNode.style.display = "none";
				this.invokeCallback();
			}else if(config['mblCSS3Transition']){
				//get dojox/css3/transit first
				Deferred.when(transitDeferred, lang.hitch(this, function(transit){
					//follow the style of .mblView.mblIn in View.css
					//need to set the toNode to absolute position
					var toPosition = domStyle.get(toNode, "position");
					domStyle.set(toNode, "position", "absolute");
					Deferred.when(transit(fromNode, toNode, {transition: transition, reverse: (transitionDir===-1)?true:false}),lang.hitch(this,function(){
						domStyle.set(toNode, "position", toPosition);
						this.invokeCallback();
					}));
				}));
			}else{
				if(transition.indexOf("cube") != -1){
					if(has('ipad')){
						domStyle.set(toNode.parentNode, {webkitPerspective:1600});
					}else if(has('iphone')){
						domStyle.set(toNode.parentNode, {webkitPerspective:800});
					}
				}
				var s = this._toCls(transition);
				if(has('mblAndroidWorkaround')){
					// workaround for the screen flicker issue on Android 2.2
					// applying transition css classes just after setting toNode.style.display = ""
					// causes flicker, so wait for a while using setTimeout
					setTimeout(function(){
						domClass.add(fromNode, s + " mblOut" + rev);
						domClass.add(toNode, s + " mblIn" + rev);
						domClass.remove(toNode, "mblAndroidWorkaround"); // remove offscreen style
						setTimeout(function(){
							domClass.add(fromNode, "mblTransition");
							domClass.add(toNode, "mblTransition");
						}, 30); // 30 = 100 - 70, to make total delay equal to 100ms
					}, 70); // 70ms is experiential value
				}else{
					domClass.add(fromNode, s + " mblOut" + rev);
					domClass.add(toNode, s + " mblIn" + rev);
					setTimeout(function(){
						domClass.add(fromNode, "mblTransition");
						domClass.add(toNode, "mblTransition");
					}, 100);
				}
				// set transform origin
				var fromOrigin = "50% 50%";
				var toOrigin = "50% 50%";
				var scrollTop, posX, posY;
				if(transition.indexOf("swirl") != -1 || transition.indexOf("zoom") != -1){
					if(this.keepScrollPos && !this.getParent()){
						scrollTop = win.body().scrollTop || win.doc.documentElement.scrollTop || win.global.pageYOffset || 0;
					}else{
						scrollTop = -domGeometry.position(fromNode, true).y;
					}
					posY = win.global.innerHeight / 2 + scrollTop;
					fromOrigin = "50% " + posY + "px";
					toOrigin = "50% " + posY + "px";
				}else if(transition.indexOf("scale") != -1){
					var viewPos = domGeometry.position(fromNode, true);
					posX = ((this.clickedPosX !== undefined) ? this.clickedPosX : win.global.innerWidth / 2) - viewPos.x;
					if(this.keepScrollPos && !this.getParent()){
						scrollTop = win.body().scrollTop || win.doc.documentElement.scrollTop || win.global.pageYOffset || 0;
					}else{
						scrollTop = -viewPos.y;
					}
					posY = ((this.clickedPosY !== undefined) ? this.clickedPosY : win.global.innerHeight / 2) + scrollTop;
					fromOrigin = posX + "px " + posY + "px";
					toOrigin = posX + "px " + posY + "px";
				}
				domStyle.set(fromNode, {webkitTransformOrigin:fromOrigin});
				domStyle.set(toNode, {webkitTransformOrigin:toOrigin});
			}
		},

		onAnimationStart: function(e){
			// summary:
			//		A handler that is called when transition animation starts.
		},

		onAnimationEnd: function(e){
			// summary:
			//		A handler that is called after transition animation ends.
			var name = e.animationName || e.target.className;
			if(name.indexOf("Out") === -1 &&
				name.indexOf("In") === -1 &&
				name.indexOf("Shrink") === -1){ return; }
			var isOut = false;
			if(domClass.contains(this.domNode, "mblOut")){
				isOut = true;
				this.domNode.style.display = "none";
				domClass.remove(this.domNode, [this._toCls(this._detail.transition), "mblIn", "mblOut", "mblReverse"]);
			}else{
				// Reset the temporary padding
				this.containerNode.style.paddingTop = "";
			}
			domStyle.set(this.domNode, {webkitTransformOrigin:""});
			if(name.indexOf("Shrink") !== -1){
				var li = e.target;
				li.style.display = "none";
				domClass.remove(li, "mblCloseContent");

				// If target is placed inside scrollable, need to call onTouchEnd
				// to adjust scroll position
				var p = viewRegistry.getEnclosingScrollable(this.domNode);
				p && p.onTouchEnd();
			}
			if(isOut){
				this.invokeCallback();
			}
			this._clearClasses(this.domNode);

			// clear the clicked position
			this.clickedPosX = this.clickedPosY = undefined;

			if(name.indexOf("Cube") !== -1 &&
				name.indexOf("In") !== -1 && has('iphone')){
				this.domNode.parentNode.style.webkitPerspective = "";
			}
		},

		invokeCallback: function(){
			// summary:
			//		A function to be called after performing a transition to
			//		call a specified callback.
			this.onAfterTransitionOut.apply(this, this._arguments);
			connect.publish("/dojox/mobile/afterTransitionOut", [this].concat(this._arguments));
			var toWidget = registry.byNode(this.toNode);
			if(toWidget){
				toWidget.onAfterTransitionIn.apply(toWidget, this._arguments);
				connect.publish("/dojox/mobile/afterTransitionIn", [toWidget].concat(this._arguments));
				toWidget.movedFrom = undefined;
				if(this.setFragIds && this._isBookmarkable(this._detail)){
					this.setFragIds(toWidget); // setFragIds is defined in bookmarkable.js
				}
			}
			if(has('mblAndroidWorkaround')){
				// workaround for the screen flicker issue on Android 2.2/2.3
				// remove "-webkit-transform-style" style after transition finished
				// to avoid side effects such as input field auto-scrolling issue
				// use setTimeout to avoid flicker in case of ScrollableView
				setTimeout(lang.hitch(this, function(){
					if(toWidget){ domStyle.set(this.toNode, "webkitTransformStyle", ""); }
					domStyle.set(this.domNode, "webkitTransformStyle", "");
				}), 0);
			}

			var c = this._detail.context, m = this._detail.method;
			if(c || m){
				if(!m){
					m = c;
					c = null;
				}
				c = c || win.global;
				if(typeof(m) == "string"){
					c[m].apply(c, this._optArgs);
				}else if(typeof(m) == "function"){
					m.apply(c, this._optArgs);
				}
			}
			this._detail = this._optArgs = this._arguments = undefined;
		},

		isVisible: function(/*Boolean?*/checkAncestors){
			// summary:
			//		Return true if this view is visible
			// checkAncestors:
			//		If true, in addition to its own visibility, also checks the
			//		ancestors visibility to see if the view is actually being
			//		shown or not.
			var visible = function(node){
				return domStyle.get(node, "display") !== "none";
			};
			if(checkAncestors){
				for(var n = this.domNode; n.tagName !== "BODY"; n = n.parentNode){
					if(!visible(n)){ return false; }
				}
				return true;
			}else{
				return visible(this.domNode);
			}
		},

		getShowingView: function(){
			// summary:
			//		Find the currently showing view from my sibling views.
			// description:
			//		Note that depending on the ancestor views' visibility,
			//		the found view may not be actually shown.
			var nodes = this.domNode.parentNode.childNodes;
			for(var i = 0; i < nodes.length; i++){
				var n = nodes[i];
				if(n.nodeType === 1 && domClass.contains(n, "mblView") && n.style.display !== "none"){
					return registry.byNode(n);
				}
			}
			return null;
		},

		getSiblingViews: function(){
			// summary:
			//		Returns an array of the sibling views.
			if(!this.domNode.parentNode){ return [this]; }
			return array.map(array.filter(this.domNode.parentNode.childNodes,
				function(n){ return n.nodeType === 1 && domClass.contains(n, "mblView"); }),
				function(n){ return registry.byNode(n); });
		},

		show: function(/*Boolean?*/noEvent, /*Boolean?*/doNotHideOthers){
			// summary:
			//		Shows this view without a transition animation.
			var out = this.getShowingView();
			if(!noEvent){
				if(out){
					out.onBeforeTransitionOut(out.id);
					connect.publish("/dojox/mobile/beforeTransitionOut", [out, out.id]);
				}
				this.onBeforeTransitionIn(this.id);
				connect.publish("/dojox/mobile/beforeTransitionIn", [this, this.id]);
			}

			if(doNotHideOthers){
				this.domNode.style.display = "";
			}else{
				array.forEach(this.getSiblingViews(), function(v){
					v.domNode.style.display = (v === this) ? "" : "none";
				}, this);
			}
			this.load && this.load(); // for ContentView

			if(!noEvent){
				if(out){
					out.onAfterTransitionOut(out.id);
					connect.publish("/dojox/mobile/afterTransitionOut", [out, out.id]);
				}
				this.onAfterTransitionIn(this.id);
				connect.publish("/dojox/mobile/afterTransitionIn", [this, this.id]);
			}
		},

		hide: function(){
			// summary:
			//		Hides this view without a transition animation.
			this.domNode.style.display = "none";
		}
	});
});

},
'dojox/mobile/ViewController':function(){
define([
	"dojo/_base/kernel",
	"dojo/_base/array",
	"dojo/_base/connect",
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/window",
	"dojo/_base/Deferred",
	"dojo/dom",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/on",
	"dojo/ready",
	"dijit/registry",
	"./ProgressIndicator",
	"./TransitionEvent",
	"./viewRegistry"
], function(dojo, array, connect, declare, lang, win, Deferred, dom, domClass, domConstruct, on, ready, registry, ProgressIndicator, TransitionEvent, viewRegistry){

	// module:
	//		dojox/mobile/ViewController

	var Controller = declare("dojox.mobile.ViewController", null, {
		// summary:
		//		A singleton class that controls view transition.
		// description:
		//		This class listens to the "startTransition" events and performs
		//		view transitions. If the transition destination is an external
		//		view specified with the url parameter, the view content is
		//		retrieved and parsed to create a new target view.

		// dataHandlerClass: Object
		//		The data handler class used to load external views,
		//		by default "dojox/mobile/dh/DataHandler"
		//		(see the Data Handlers page in the reference documentation).
		dataHandlerClass: "dojox/mobile/dh/DataHandler",
		// dataSourceClass: Object
		//		The data source class used to load external views,
		//		by default "dojox/mobile/dh/UrlDataSource"
		//		(see the Data Handlers page in the reference documentation).
		dataSourceClass: "dojox/mobile/dh/UrlDataSource",
		// fileTypeMapClass: Object
		//		The file type map class used to load external views,
		//		by default "dojox/mobile/dh/SuffixFileTypeMap"
		//		(see the Data Handlers page in the reference documentation).
		fileTypeMapClass: "dojox/mobile/dh/SuffixFileTypeMap",

		constructor: function(){
			// summary:
			//		Creates a new instance of the class.
			// tags:
			//		private
			this.viewMap = {};
			ready(lang.hitch(this, function(){
				on(win.body(), "startTransition", lang.hitch(this, "onStartTransition"));
			}));
		},

		findTransitionViews: function(/*String*/moveTo){
			// summary:
			//		Parses the moveTo argument and determines a starting view and a destination view.
			// returns: Array
			//		An array containing the currently showing view, the destination view
			//		and the transition parameters, or an empty array if the moveTo argument
			//		could not be parsed. 
			if(!moveTo){ return []; }
			// removes a leading hash mark (#) and params if exists
			// ex. "#bar&myParam=0003" -> "bar"
			moveTo.match(/^#?([^&?]+)(.*)/);
			var params = RegExp.$2;
			var view = registry.byId(RegExp.$1);
			if(!view){ return []; }
			for(var v = view.getParent(); v; v = v.getParent()){ // search for the topmost invisible parent node
				if(v.isVisible && !v.isVisible()){
					var sv = view.getShowingView();
					if(sv && sv.id !== view.id){
						view.show();
					}
					view = v;
				}
			}
			return [view.getShowingView(), view, params]; // fromView, toView, params
		},

		openExternalView: function(/*Object*/ transOpts, /*DomNode*/ target){
			// summary:
			//		Loads an external view and performs a transition to it.
			// returns: dojo/_base/Deferred
			//		Deferred object that resolves when the external view is
			//		ready and a transition starts. Note that it resolves before
			//		the transition is complete.
			// description:
			//		This method loads external view content through the
			//		dojox/mobile data handlers, creates a new View instance with
			//		the loaded content, and performs a view transition to the
			//		new view. The external view content can be specified with
			//		the url property of transOpts. The new view is created under
			//		a DOM node specified by target.
			//
			// example:
			//		This example loads view1.html, creates a new view under
			//		`<body>`, and performs a transition to the new view with the
			//		slide animation.
			//		
			//	|	var vc = ViewController.getInstance();
			//	|	vc.openExternalView({
			//	|	    url: "view1.html", 
			//	|	    transition: "slide"
			//	|	}, win.body());
			//
			//
			// example:
			//		If you want to perform a view transition without animation,
			//		you can give transition:"none" to transOpts.
			//
			//	|	var vc = ViewController.getInstance();
			//	|	vc.openExternalView({
			//	|	    url: "view1.html", 
			//	|	    transition: "none"
			//	|	}, win.body());
			//
			// example:
			//		If you want to dynamically create an external view, but do
			//		not want to perform a view transition to it, you can give noTransition:true to transOpts.
			//		This may be useful when you want to preload external views before the user starts using them.
			//
			//	|	var vc = ViewController.getInstance();
			//	|	vc.openExternalView({
			//	|	    url: "view1.html", 
			//	|	    noTransition: true
			//	|	}, win.body());
			//
			// example:
			//		To do something when the external view is ready:
			//
			//	|	var vc = ViewController.getInstance();
			//	|	Deferred.when(vc.openExternalView({...}, win.body()), function(){
			//	|	    doSomething();
			//	|	});

			var d = new Deferred();
			var id = this.viewMap[transOpts.url];
			if(id){
				transOpts.moveTo = id;
				if(transOpts.noTransition){
					registry.byId(id).hide();
				}else{
					new TransitionEvent(win.body(), transOpts).dispatch();
				}
				d.resolve(true);
				return d;
			}

			// if a fixed bottom bar exists, a new view should be placed before it.
			var refNode = null;
			for(var i = target.childNodes.length - 1; i >= 0; i--){
				var c = target.childNodes[i];
				if(c.nodeType === 1){
					var fixed = c.getAttribute("fixed")
						|| (registry.byNode(c) && registry.byNode(c).fixed);
					if(fixed === "bottom"){
						refNode = c;
						break;
					}
				}
			}

			var dh = transOpts.dataHandlerClass || this.dataHandlerClass;
			var ds = transOpts.dataSourceClass || this.dataSourceClass;
			var ft = transOpts.fileTypeMapClass || this.fileTypeMapClass;
			require([dh, ds, ft], lang.hitch(this, function(DataHandler, DataSource, FileTypeMap){
				var handler = new DataHandler(new DataSource(transOpts.data || transOpts.url), target, refNode);
				var contentType = transOpts.contentType || FileTypeMap.getContentType(transOpts.url) || "html";
				handler.processData(contentType, lang.hitch(this, function(id){
					if(id){
						this.viewMap[transOpts.url] = transOpts.moveTo = id;
						if(transOpts.noTransition){
							registry.byId(id).hide();
						}else{
							new TransitionEvent(win.body(), transOpts).dispatch();
						}
						d.resolve(true);
					}else{
						d.reject("Failed to load "+transOpts.url);
					}
				}));
			}));
			return d;
		},

		onStartTransition: function(evt){
			// summary:
			//		A handler that performs view transition.
			evt.preventDefault();
			if(!evt.detail){ return; }
			var detail = evt.detail;
			if(!detail.moveTo && !detail.href && !detail.url && !detail.scene){ return; }

			if(detail.url && !detail.moveTo){
				var urlTarget = detail.urlTarget;
				var w = registry.byId(urlTarget);
				var target = w && w.containerNode || dom.byId(urlTarget);
				if(!target){
					w = viewRegistry.getEnclosingView(evt.target);
					target = w && w.domNode.parentNode || win.body();
				}
				this.openExternalView(detail, target);
				return;
			}else if(detail.href){
				if(detail.hrefTarget){
					win.global.open(detail.href, detail.hrefTarget);
				}else{
					var view; // find top level visible view
					for(var v = viewRegistry.getEnclosingView(evt.target); v; v = viewRegistry.getParentView(v)){
						view = v;
					}
					if(view){
						view.performTransition(null, detail.transitionDir, detail.transition, evt.target, function(){location.href = detail.href;});
					}
				}
				return;
			}else if(detail.scene){
				connect.publish("/dojox/mobile/app/pushScene", [detail.scene]);
				return;
			}

			var arr = this.findTransitionViews(detail.moveTo),
				fromView = arr[0],
				toView = arr[1],
				params = arr[2];
			if(!location.hash && !detail.hashchange){
				viewRegistry.initialView = fromView;
			}
			if(detail.moveTo && toView){
				detail.moveTo = (detail.moveTo.charAt(0) === '#' ? '#' + toView.id : toView.id) + params;
			}
			if(!fromView || (detail.moveTo && fromView === registry.byId(detail.moveTo.replace(/^#?([^&?]+).*/, "$1")))){ return; }
			var src = registry.getEnclosingWidget(evt.target);
			if(src && src.callback){
				detail.context = src;
				detail.method = src.callback;
			}
			fromView.performTransition(detail);
		}
	});
	Controller._instance = new Controller(); // singleton
	Controller.getInstance = function(){
		return Controller._instance;
	};
	return Controller;
});


},
'dojox/mobile/viewRegistry':function(){
define([
	"dojo/_base/array",
	"dojo/dom-class",
	"dijit/registry"
], function(array, domClass, registry){

	// module:
	//		dojox/mobile/viewRegistry

	var viewRegistry = {
		// summary:
		//		A registry of existing views.

		// length: Number
		//		The number of registered views.
		length: 0,
		
		// hash: [private] Object
		//		The object used to register views.
		hash: {},
		
		// initialView: [private] dojox/mobile/View
		//		The initial view.
		initialView: null,

		add: function(/*dojox/mobile/View*/ view){
			// summary:
			//		Adds a view to the registry.
			this.hash[view.id] = view;
			this.length++;
		},

		remove: function(/*String*/ id){
			// summary:
			//		Removes a view from the registry.
			if(this.hash[id]){
				delete this.hash[id];
				this.length--;
			}
		},

		getViews: function(){
			// summary:
			//		Gets all registered views.
			// returns: Array
			var arr = [];
			for(var i in this.hash){
				arr.push(this.hash[i]);
			}
			return arr;
		},

		getParentView: function(/*dojox/mobile/View*/ view){
			// summary:
			//		Gets the parent view of the specified view.
			// returns: dojox/mobile/View
			for(var v = view.getParent(); v; v = v.getParent()){
				if(domClass.contains(v.domNode, "mblView")){ return v; }
			}
			return null;
		},

		getChildViews: function(/*dojox/mobile/View*/ parent){
			// summary:
			//		Gets the children views of the specified view.
			// returns: Array
			return array.filter(this.getViews(), function(v){ return this.getParentView(v) === parent; }, this);
		},

		getEnclosingView: function(/*DomNode*/ node){
			// summary:
			//		Gets the view containing the specified DOM node.
			// returns: dojox/mobile/View
			for(var n = node; n && n.tagName !== "BODY"; n = n.parentNode){
				if(n.nodeType === 1 && domClass.contains(n, "mblView")){
					return registry.byNode(n);
				}
			}
			return null;
		},

		getEnclosingScrollable: function(/*DomNode*/ node){
			// summary:
			//		Gets the dojox/mobile/scrollable object containing the specified DOM node.
			// returns: dojox/mobile/scrollable
			for(var w = registry.getEnclosingWidget(node); w; w = w.getParent()){
				if(w.scrollableParams && w._v){ return w; }
			}
			return null;
		}
	};

	return viewRegistry;
});

},
'dojox/mobile/common':function(){
define([
	"dojo/_base/array",
	"dojo/_base/config",
	"dojo/_base/connect",
	"dojo/_base/lang",
	"dojo/_base/window",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/ready",
	"dijit/registry",
	"./sniff",
	"./uacss" // (no direct references)
], function(array, config, connect, lang, win, domClass, domConstruct, ready, registry, has){

	// module:
	//		dojox/mobile/common

	var dm = lang.getObject("dojox.mobile", true);

	dm.getScreenSize = function(){
		// summary:
		//		Returns the dimensions of the browser window.
		return {
			h: win.global.innerHeight || win.doc.documentElement.clientHeight,
			w: win.global.innerWidth || win.doc.documentElement.clientWidth
		};
	};

	dm.updateOrient = function(){
		// summary:
		//		Updates the orientation specific CSS classes, 'dj_portrait' and
		//		'dj_landscape'.
		var dim = dm.getScreenSize();
		domClass.replace(win.doc.documentElement,
				  dim.h > dim.w ? "dj_portrait" : "dj_landscape",
				  dim.h > dim.w ? "dj_landscape" : "dj_portrait");
	};
	dm.updateOrient();

	dm.tabletSize = 500;
	dm.detectScreenSize = function(/*Boolean?*/force){
		// summary:
		//		Detects the screen size and determines if the screen is like
		//		phone or like tablet. If the result is changed,
		//		it sets either of the following css class to `<html>`:
		//
		//		- 'dj_phone'
		//		- 'dj_tablet'
		//
		//		and it publishes either of the following events:
		//
		//		- '/dojox/mobile/screenSize/phone'
		//		- '/dojox/mobile/screenSize/tablet'

		var dim = dm.getScreenSize();
		var sz = Math.min(dim.w, dim.h);
		var from, to;
		if(sz >= dm.tabletSize && (force || (!this._sz || this._sz < dm.tabletSize))){
			from = "phone";
			to = "tablet";
		}else if(sz < dm.tabletSize && (force || (!this._sz || this._sz >= dm.tabletSize))){
			from = "tablet";
			to = "phone";
		}
		if(to){
			domClass.replace(win.doc.documentElement, "dj_"+to, "dj_"+from);
			connect.publish("/dojox/mobile/screenSize/"+to, [dim]);
		}
		this._sz = sz;
	};
	dm.detectScreenSize();

	// dojox/mobile.hideAddressBarWait: Number
	//		The time in milliseconds to wait before the fail-safe hiding address
	//		bar runs. The value must be larger than 800.
	dm.hideAddressBarWait = typeof(config["mblHideAddressBarWait"]) === "number" ?
		config["mblHideAddressBarWait"] : 1500;

	dm.hide_1 = function(){
		// summary:
		//		Internal function to hide the address bar.
		// tags:
		//		private
		scrollTo(0, 1);
		dm._hidingTimer = (dm._hidingTimer == 0) ? 200 : dm._hidingTimer * 2;
		setTimeout(function(){ // wait for a while for "scrollTo" to finish
			if(dm.isAddressBarHidden() || dm._hidingTimer > dm.hideAddressBarWait){
				// Succeeded to hide address bar, or failed but timed out 
				dm.resizeAll();
				dm._hiding = false;
			}else{
				// Failed to hide address bar, so retry after a while
				setTimeout(dm.hide_1, dm._hidingTimer);
			}
		}, 50); //50ms is an experiential value
	};

	dm.hideAddressBar = function(/*Event?*/evt){
		// summary:
		//		Hides the address bar.
		// description:
		//		Tries to hide the address bar a couple of times. The purpose is to do 
		//		it as quick as possible while ensuring the resize is done after the hiding
		//		finishes.
		if(dm.disableHideAddressBar || dm._hiding){ return; }
		dm._hiding = true;
		dm._hidingTimer = has('iphone') ? 200 : 0; // Need to wait longer in case of iPhone
		var minH = screen.availHeight;
		if(has('android')){
			minH = outerHeight / devicePixelRatio;
			// On some Android devices such as Galaxy SII, minH might be 0 at this time.
			// In that case, retry again after a while. (200ms is an experiential value)
			if(minH == 0){
				dm._hiding = false;
				setTimeout(function(){ dm.hideAddressBar(); }, 200);
			}
			// On some Android devices such as HTC EVO, "outerHeight/devicePixelRatio"
			// is too short to hide address bar, so make it high enough
			if(minH <= innerHeight){ minH = outerHeight; }
			// On Android 2.2/2.3, hiding address bar fails when "overflow:hidden" style is
			// applied to html/body element, so force "overflow:visible" style
			if(has('android') < 3){
				win.doc.documentElement.style.overflow = win.body().style.overflow = "visible";
			}
		}
		if(win.body().offsetHeight < minH){ // to ensure enough height for scrollTo to work
			win.body().style.minHeight = minH + "px";
			dm._resetMinHeight = true;
		}
		setTimeout(dm.hide_1, dm._hidingTimer);
	};

	dm.isAddressBarHidden = function(){
		return pageYOffset === 1;
	};

	dm.resizeAll = function(/*Event?*/evt, /*Widget?*/root){
		// summary:
		//		Calls the resize() method of all the top level resizable widgets.
		// description:
		//		Finds all widgets that do not have a parent or the parent does not
		//		have the resize() method, and calls resize() for them.
		//		If a widget has a parent that has resize(), calling widget's
		//		resize() is its parent's responsibility.
		// evt:
		//		Native event object
		// root:
		//		If specified, searches the specified widget recursively for top-level
		//		resizable widgets.
		//		root.resize() is always called regardless of whether root is a
		//		top level widget or not.
		//		If omitted, searches the entire page.
		if(dm.disableResizeAll){ return; }
		connect.publish("/dojox/mobile/resizeAll", [evt, root]); // back compat
		connect.publish("/dojox/mobile/beforeResizeAll", [evt, root]);
		if(dm._resetMinHeight){
			win.body().style.minHeight = dm.getScreenSize().h + "px";
		} 
		dm.updateOrient();
		dm.detectScreenSize();
		var isTopLevel = function(w){
			var parent = w.getParent && w.getParent();
			return !!((!parent || !parent.resize) && w.resize);
		};
		var resizeRecursively = function(w){
			array.forEach(w.getChildren(), function(child){
				if(isTopLevel(child)){ child.resize(); }
				resizeRecursively(child);
			});
		};
		if(root){
			if(root.resize){ root.resize(); }
			resizeRecursively(root);
		}else{
			array.forEach(array.filter(registry.toArray(), isTopLevel),
					function(w){ w.resize(); });
		}
		connect.publish("/dojox/mobile/afterResizeAll", [evt, root]);
	};

	dm.openWindow = function(url, target){
		// summary:
		//		Opens a new browser window with the given URL.
		win.global.open(url, target || "_blank");
	};

	if(config["mblApplyPageStyles"] !== false){
		domClass.add(win.doc.documentElement, "mobile");
	}
	if(has('chrome')){
		// dojox/mobile does not load uacss (only _compat does), but we need dj_chrome.
		domClass.add(win.doc.documentElement, "dj_chrome");
	}

	if(win.global._no_dojo_dm){
		// deviceTheme seems to be loaded from a script tag (= non-dojo usage)
		var _dm = win.global._no_dojo_dm;
		for(var i in _dm){
			dm[i] = _dm[i];
		}
		dm.deviceTheme.setDm(dm);
	}

	// flag for Android transition animation flicker workaround
	has.add('mblAndroidWorkaround', 
			config["mblAndroidWorkaround"] !== false && has('android') < 3, undefined, true);
	has.add('mblAndroid3Workaround', 
			config["mblAndroid3Workaround"] !== false && has('android') >= 3, undefined, true);

	ready(function(){
		dm.detectScreenSize(true);

		if(config["mblAndroidWorkaroundButtonStyle"] !== false && has('android')){
			// workaround for the form button disappearing issue on Android 2.2-4.0
			domConstruct.create("style", {innerHTML:"BUTTON,INPUT[type='button'],INPUT[type='submit'],INPUT[type='reset'],INPUT[type='file']::-webkit-file-upload-button{-webkit-appearance:none;}"}, win.doc.head, "first");
		}
		if(has('mblAndroidWorkaround')){
			// add a css class to show view offscreen for android flicker workaround
			domConstruct.create("style", {innerHTML:".mblView.mblAndroidWorkaround{position:absolute;top:-9999px !important;left:-9999px !important;}"}, win.doc.head, "last");
		}

		//	You can disable hiding the address bar with the following dojoConfig.
		//	var dojoConfig = { mblHideAddressBar: false };
		var f = dm.resizeAll;
		if(config["mblHideAddressBar"] !== false &&
			navigator.appVersion.indexOf("Mobile") != -1 ||
			config["mblForceHideAddressBar"] === true){
			dm.hideAddressBar();
			if(config["mblAlwaysHideAddressBar"] === true){
				f = dm.hideAddressBar;
			}
		}

		var ios6 = has('iphone') >= 6; // Full-screen support for iOS6 or later 
		if((has('android') || ios6) && win.global.onorientationchange !== undefined){
			var _f = f;
			f = function(evt){
				var _conn = connect.connect(null, "onresize", null, function(e){
					connect.disconnect(_conn);
					_f(e);
				});
			};
			var curSize = dm.getScreenSize();
			var heightChangeThreshold = ios6 ? 20 : 100;
			var lastKeyUpTime = null;
			var isFormElement = null;
			if(ios6){
				// Surprisingly, on iOS 6, Mobile Safari fires a resize event when entering
				// characters using the virtual keyboard. Hence, to avoid inappropriately reacting 
				// on these resize events (see #16202), let's keep track of the time point of
				// the keyup events (the resize event is fired after it).
				connect.connect(null, "onkeyup", null, function(e){
					lastKeyUpTime = (new Date()).getTime();
				});
				isFormElement = function(/*DOMNode*/node){ // returns true if the given node is a form control
					if(node && node.nodeType !== 1){ node = node.parentNode; }
					if(!node || node.nodeType !== 1){ return false; }
					var t = node.tagName;
					return (t === "SELECT" || t === "INPUT" || t === "TEXTAREA" || t === "BUTTON");
				};
			}
			// Android: Watch for resize events when the virtual keyboard is shown/hidden.
			// The heuristic to detect this is that the screen width does not change
			// and the height changes by more than 100 pixels.
			//
			// iOS >= 6: Watch for resize events when entering or existing the new iOS6 
			// full-screen mode. The heuristic to detect this is that the screen width does not
			// change and the height changes by more than 20 pixels (the actual value depends on
			// whether the address bar is hidden or shown). Note that there are 2 resize events 
			// when entering the full-screen mode; the height is already changed when we get
			// the first event; no further height change at the second event (that we skip 
			// thanks to the height change test). Differently, there is only one resize event
			// when exiting the full-screen mode. (Tested on iPhone 4S under iOS 6.0.)
			connect.connect(null, "onresize", null, function(e){
				var newSize = dm.getScreenSize();
				if(newSize.w == curSize.w && Math.abs(newSize.h - curSize.h) >= heightChangeThreshold &&
					!(ios6 && 
						// do not react on resize events fired shortly after a keyup event (#16202)
						((lastKeyUpTime && ((new Date()).getTime() - lastKeyUpTime) < 400) ||
						// do not react on resize events fired while a form element is active (#16361)
						isFormElement(win.doc.activeElement)))){
					// keyboard has been shown/hidden (Android), or full-screen mode has
					// been entered/exited (iOS6+).
					if(ios6 && pageYOffset > 1){
						// On iOS6, besides the resize events fired when entering a character using
						// the virtual keyboard, there are sometimes resize events fired when editing 
						// input fields even long after a key event, or without any key having been touched. 
						// This situation sometimes occurs when repeatedly switching the focus back and forth
						// from one input field to another (the virtual keyboard being shown). 
						// Thus, to prevent the unexpected browser scroll due to the address bar hiding that 
						// the "_f" function may do, we call directly "resizeAll" if the browser vertical scroll 
						// is greater than 1, which is an indication that the virtual keyboard may be open. 
						// In this case, we do not want to interfer with the browser scroll done for placing 
						// the focused input field in the center of the visible area. Otherwise, we call
						// "resizeAll" such that the address bar hiding is performed (if appropriate), 
						// this being useful on both Android's case and for the iOS6 full-screen mode.
						dm.resizeAll();	
					}else{
						_f(e);
					}
				}
				curSize = newSize;
			});
		}
		
		connect.connect(null, win.global.onorientationchange !== undefined
			? "onorientationchange" : "onresize", null, f);
		win.body().style.visibility = "visible";
	});

	// TODO: return functions declared above in this hash, rather than
	// dojox.mobile.

	/*=====
	return {
		// summary:
		//		A common module for dojox/mobile.
		// description:
		//		This module includes common utility functions that are used by
		//		dojox/mobile widgets. Also, it provides functions that are commonly
		//		necessary for mobile web applications, such as the hide address bar
		//		function.
	};
	=====*/
	return dm;
});

},
'dojox/mobile/uacss':function(){
define([
	"dojo/_base/kernel",
	"dojo/_base/lang",
	"dojo/_base/window",
	"./sniff"
], function(dojo, lang, win, has){
	var html = win.doc.documentElement;
	html.className = lang.trim(html.className + " " + [
		has('bb') ? "dj_bb" : "",
		has('android') ? "dj_android" : "",
		has('iphone') ? "dj_iphone" : "",
		has('ipod') ? "dj_ipod" : "",
		has('ipad') ? "dj_ipad" : ""
	].join(" ").replace(/ +/g," "));
	
	/*=====
	return {
		// summary:
		//		Requiring this module adds CSS classes to your document's `<html`> tag:
		//
		//		- "dj_android" when running on Android;
		//		- "dj_bb" when running on BlackBerry;
		//		- "dj_iphone" when running on iPhone;
		//		- "dj_ipod" when running on iPod;
		//		- "dj_ipad" when running on iPad.
	};
	=====*/
	return dojo;
});

},
'dojox/mobile/ListItem':function(){
define([
	"dojo/_base/array",
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/dom-style",
	"dijit/registry",
	"dijit/_WidgetBase",
	"./iconUtils",
	"./_ItemBase",
	"./ProgressIndicator"
], function(array, declare, lang, domClass, domConstruct, domStyle, registry, WidgetBase, iconUtils, ItemBase, ProgressIndicator){

	// module:
	//		dojox/mobile/ListItem

	var ListItem = declare("dojox.mobile.ListItem", ItemBase, {
		// summary:
		//		An item of either RoundRectList or EdgeToEdgeList.
		// description:
		//		ListItem represents an item of either RoundRectList or
		//		EdgeToEdgeList. There are three ways to move to a different view:
		//		moveTo, href, and url. You can choose only one of them.
		//
		//		A child DOM node (or widget) can have the layout attribute,
		//		whose value is "left", "right", or "center". Such nodes will be
		//		aligned as specified.
		// example:
		// |	<li data-dojo-type="dojox.mobile.ListItem">
		// |		<div layout="left">Left Node</div>
		// |		<div layout="right">Right Node</div>
		// |		<div layout="center">Center Node</div>
		// |	</li>
		//
		//		Note that even if you specify variableHeight="true" for the list
		//		and place a tall object inside the layout node as in the example
		//		below, the layout node does not expand as you may expect,
		//		because layout node is aligned using float:left, float:right, or
		//		position:absolute.
		// example:
		// |	<li data-dojo-type="dojox.mobile.ListItem" variableHeight="true">
		// |		<div layout="left"><img src="large-picture.jpg"></div>
		// |	</li>

		// rightText: String
		//		A right-aligned text to display on the item.
		rightText: "",

		// rightIcon: String
		//		An icon to display at the right hand side of the item. The value
		//		can be either a path for an image file or a class name of a DOM
		//		button.
		rightIcon: "",

		// rightIcon2: String
		//		An icon to display at the left of the rightIcon. The value can
		//		be either a path for an image file or a class name of a DOM
		//		button.
		rightIcon2: "",

		// deleteIcon: String
		//		A delete icon to display at the left of the item. The value can
		//		be either a path for an image file or a class name of a DOM
		//		button.
		deleteIcon: "",

		// anchorLabel: Boolean
		//		If true, the label text becomes a clickable anchor text. When
		//		the user clicks on the text, the onAnchorLabelClicked handler is
		//		called. You can override or connect to the handler and implement
		//		any action. The handler has no default action.
		anchorLabel: false,

		// noArrow: Boolean
		//		If true, the right hand side arrow is not displayed.
		noArrow: false,

		// checked: Boolean
		//		If true, a check mark is displayed at the right of the item.
		checked: false,

		// arrowClass: String
		//		An icon to display as an arrow. The value can be either a path
		//		for an image file or a class name of a DOM button.
		arrowClass: "",

		// checkClass: String
		//		An icon to display as a check mark. The value can be either a
		//		path for an image file or a class name of a DOM button.
		checkClass: "",

		// uncheckClass: String
		//		An icon to display as an uncheck mark. The value can be either a
		//		path for an image file or a class name of a DOM button.
		uncheckClass: "",

		// variableHeight: Boolean
		//		If true, the height of the item varies according to its
		//		content. In dojo 1.6 or older, the "mblVariableHeight" class was
		//		used for this purpose. In dojo 1.7, adding the mblVariableHeight
		//		class still works for backward compatibility.
		variableHeight: false,

		// rightIconTitle: String
		//		An alt text for the right icon.
		rightIconTitle: "",

		// rightIcon2Title: String
		//		An alt text for the right icon2.
		rightIcon2Title: "",

		// header: Boolean
		//		If true, this item is rendered as a category header.
		header: false,

		// tag: String
		//		A name of html tag to create as domNode.
		tag: "li",

		// busy: Boolean
		//		If true, a progress indicator spins.
		busy: false,

		// progStyle: String
		//		A css class name to add to the progress indicator.
		progStyle: "",

		/* internal properties */	
		// The following properties are overrides of those in _ItemBase.
		paramsToInherit: "variableHeight,transition,deleteIcon,icon,rightIcon,rightIcon2,uncheckIcon,arrowClass,checkClass,uncheckClass,deleteIconTitle,deleteIconRole",
		baseClass: "mblListItem",

		_selStartMethod: "touch",
		_selEndMethod: "timer",
		_delayedSelection: true,

		_selClass: "mblListItemSelected",

		buildRendering: function(){
			this.domNode = this.containerNode = this.srcNodeRef || domConstruct.create(this.tag);
			this.inherited(arguments);

			if(this.selected){
				domClass.add(this.domNode, this._selClass);
			}
			if(this.header){
				domClass.replace(this.domNode, "mblEdgeToEdgeCategory", this.baseClass);
			}

			this.labelNode =
				domConstruct.create("div", {className:"mblListItemLabel"});
			var ref = this.srcNodeRef;
			if(ref && ref.childNodes.length === 1 && ref.firstChild.nodeType === 3){
				// if ref has only one text node, regard it as a label
				this.labelNode.appendChild(ref.firstChild);
			}
			this.domNode.appendChild(this.labelNode);

			if(this.anchorLabel){
				this.labelNode.style.display = "inline"; // to narrow the text region
				this.labelNode.style.cursor = "pointer";
				this._anchorClickHandle = this.connect(this.labelNode, "onclick", "_onClick");
				this.onTouchStart = function(e){
					return (e.target !== this.labelNode);
				};
			}
			this._layoutChildren = [];
		},

		startup: function(){
			if(this._started){ return; }

			var parent = this.getParent();
			var opts = this.getTransOpts();
			if(opts.moveTo || opts.href || opts.url || this.clickable || (parent && parent.select)){
				this._keydownHandle = this.connect(this.domNode, "onkeydown", "_onClick"); // for desktop browsers
			}else{
				this._handleClick = false;
			}

			this.inherited(arguments);
			
			if(domClass.contains(this.domNode, "mblVariableHeight")){
				this.variableHeight = true;
			}
			if(this.variableHeight){
				domClass.add(this.domNode, "mblVariableHeight");
				this.defer(lang.hitch(this, "layoutVariableHeight"), 0);
			}

			if(!this._isOnLine){
				this._isOnLine = true;
				this.set({ 
					// retry applying the attributes for which the custom setter delays the actual 
					// work until _isOnLine is true
					icon: this._pending_icon !== undefined ? this._pending_icon : this.icon,
					deleteIcon: this._pending_deleteIcon !== undefined ? this._pending_deleteIcon : this.deleteIcon,
					rightIcon: this._pending_rightIcon !== undefined ? this._pending_rightIcon : this.rightIcon,
					rightIcon2: this._pending_rightIcon2 !== undefined ? this._pending_rightIcon2 : this.rightIcon2,
					uncheckIcon: this._pending_uncheckIcon !== undefined ? this._pending_uncheckIcon : this.uncheckIcon 
				});
				// Not needed anymore (this code executes only once per life cycle):
				delete this._pending_icon;
				delete this._pending_deleteIcon;
				delete this._pending_rightIcon;
				delete this._pending_rightIcon2;
				delete this._pending_uncheckIcon;
			}
			if(parent && parent.select){
				// retry applying the attributes for which the custom setter delays the actual 
				// work until _isOnLine is true. 
				this.set("checked", this._pendingChecked !== undefined ? this._pendingChecked : this.checked);
				// Not needed anymore (this code executes only once per life cycle):
				delete this._pendingChecked; 
			}
			this.setArrow();
			this.layoutChildren();
		},

		layoutChildren: function(){
			var centerNode;
			array.forEach(this.domNode.childNodes, function(n){
				if(n.nodeType !== 1){ return; }
				var layout = n.getAttribute("layout") || (registry.byNode(n) || {}).layout;
				if(layout){
					domClass.add(n, "mblListItemLayout" +
						layout.charAt(0).toUpperCase() + layout.substring(1));
					this._layoutChildren.push(n);
					if(layout === "center"){ centerNode = n; }
				}
			}, this);
			if(centerNode){
				this.domNode.insertBefore(centerNode, this.domNode.firstChild);
			}
		},

		resize: function(){
			if(this.variableHeight){
				this.layoutVariableHeight();
			}

			// If labelNode is empty, shrink it so as not to prevent user clicks.
			this.labelNode.style.display = this.labelNode.firstChild ? "block" : "inline";
		},

		_onTouchStart: function(e){
			// tags:
			//		private
			if(e.target.getAttribute("preventTouch") ||
				(registry.getEnclosingWidget(e.target) || {}).preventTouch){
				return;
			}
			this.inherited(arguments);
		},

		_onClick: function(e){
			// summary:
			//		Internal handler for click events.
			// tags:
			//		private
			if(this.getParent().isEditing || e && e.type === "keydown" && e.keyCode !== 13){ return; }
			if(this.onClick(e) === false){ return; } // user's click action
			var n = this.labelNode;
			if(this.anchorLabel && e.currentTarget === n){
				domClass.add(n, "mblListItemLabelSelected");
				setTimeout(function(){
					domClass.remove(n, "mblListItemLabelSelected");
				}, this._duration);
				this.onAnchorLabelClicked(e);
				return;
			}
			var parent = this.getParent();
			if(parent.select){
				if(parent.select === "single"){
					if(!this.checked){
						this.set("checked", true);
					}
				}else if(parent.select === "multiple"){
					this.set("checked", !this.checked);
				}
			}
			this.defaultClickAction(e);
		},

		onClick: function(/*Event*/ /*===== e =====*/){
			// summary:
			//		User-defined function to handle clicks.
			// tags:
			//		callback
		},

		onAnchorLabelClicked: function(e){
			// summary:
			//		Stub function to connect to from your application.
		},

		layoutVariableHeight: function(){
			// summary:
			//		Lays out the current item with variable height.
			var h = this.domNode.offsetHeight;
			if(h === this.domNodeHeight){ return; }
			this.domNodeHeight = h;
			array.forEach(this._layoutChildren.concat([
				this.rightTextNode,
				this.rightIcon2Node,
				this.rightIconNode,
				this.uncheckIconNode,
				this.iconNode,
				this.deleteIconNode,
				this.knobIconNode
			]), function(n){
				if(n){
					var domNode = this.domNode;
					var f = function(){
						var t = Math.round((domNode.offsetHeight - n.offsetHeight) / 2) -
							domStyle.get(domNode, "paddingTop");
						n.style.marginTop = t + "px";
					}
					if(n.offsetHeight === 0 && n.tagName === "IMG"){
						n.onload = f;
					}else{
						f();
					}
				}
			}, this);
		},

		setArrow: function(){
			// summary:
			//		Sets the arrow icon if necessary.
			if(this.checked){ return; }
			var c = "";
			var parent = this.getParent();
			var opts = this.getTransOpts();
			if(opts.moveTo || opts.href || opts.url || this.clickable){
				if(!this.noArrow && !(parent && parent.selectOne)){
					c = this.arrowClass || "mblDomButtonArrow";
				}
			}
			if(c){
				this._setRightIconAttr(c);
			}
		},

		_findRef: function(/*String*/type){
			// summary:
			//		Find an appropriate position to insert a new child node.
			// tags:
			//		private
			var i, node, list = ["deleteIcon", "icon", "rightIcon", "uncheckIcon", "rightIcon2", "rightText"];
			for(i = array.indexOf(list, type) + 1; i < list.length; i++){
				node = this[list[i] + "Node"];
				if(node){ return node; }
			}
			for(i = list.length - 1; i >= 0; i--){
				node = this[list[i] + "Node"];
				if(node){ return node.nextSibling; }
			}
			return this.domNode.firstChild;
		},
		
		_setIcon: function(/*String*/icon, /*String*/type){
			// tags:
			//		private
			if(!this._isOnLine){
				// record the value to be able to reapply it (see the code in the startup method)
				this["_pending_" + type] = icon;
				return; 
			} // icon may be invalid because inheritParams is not called yet
			this._set(type, icon);
			this[type + "Node"] = iconUtils.setIcon(icon, this[type + "Pos"],
				this[type + "Node"], this[type + "Title"] || this.alt, this.domNode, this._findRef(type), "before");
			if(this[type + "Node"]){
				var cap = type.charAt(0).toUpperCase() + type.substring(1);
				domClass.add(this[type + "Node"], "mblListItem" + cap);
			}
			var role = this[type + "Role"];
			if(role){
				this[type + "Node"].setAttribute("role", role);
			}
		},

		_setDeleteIconAttr: function(/*String*/icon){
			// tags:
			//		private
			this._setIcon(icon, "deleteIcon");
		},

		_setIconAttr: function(icon){
			// tags:
			//		private
			this._setIcon(icon, "icon");
		},

		_setRightTextAttr: function(/*String*/text){
			// tags:
			//		private
			if(!this.rightTextNode){
				this.rightTextNode = domConstruct.create("div", {className:"mblListItemRightText"}, this.labelNode, "before");
			}
			this.rightText = text;
			this.rightTextNode.innerHTML = this._cv ? this._cv(text) : text;
		},

		_setRightIconAttr: function(/*String*/icon){
			// tags:
			//		private
			this._setIcon(icon, "rightIcon");
		},

		_setUncheckIconAttr: function(/*String*/icon){
			// tags:
			//		private
			this._setIcon(icon, "uncheckIcon");
		},

		_setRightIcon2Attr: function(/*String*/icon){
			// tags:
			//		private
			this._setIcon(icon, "rightIcon2");
		},

		_setCheckedAttr: function(/*Boolean*/checked){
			// tags:
			//		private
			if(!this._isOnLine){
				// record the value to be able to reapply it (see the code in the startup method)
				this._pendingChecked = checked; 
				return; 
			} // icon may be invalid because inheritParams is not called yet
			var parent = this.getParent();
			if(parent && parent.select === "single" && checked){
				array.forEach(parent.getChildren(), function(child){
					child !== this && child.checked && child.set("checked", false);
				}, this);
			}
			this._setRightIconAttr(this.checkClass || "mblDomButtonCheck");
			this._setUncheckIconAttr(this.uncheckClass);

			domClass.toggle(this.domNode, "mblListItemChecked", checked);
			domClass.toggle(this.domNode, "mblListItemUnchecked", !checked);
			domClass.toggle(this.domNode, "mblListItemHasUncheck", !!this.uncheckIconNode);
			this.rightIconNode.style.position = (this.uncheckIconNode && !checked) ? "absolute" : "";

			if(parent && this.checked !== checked){
				parent.onCheckStateChanged(this, checked);
			}
			this._set("checked", checked);
		},

		_setBusyAttr: function(/*Boolean*/busy){
			// tags:
			//		private
			var prog = this._prog;
			if(busy){
				if(!this._progNode){
					this._progNode = domConstruct.create("div", {className:"mblListItemIcon"});
					prog = this._prog = new ProgressIndicator({size:25, center:false});
					domClass.add(prog.domNode, this.progStyle);
					this._progNode.appendChild(prog.domNode);
				}
				if(this.iconNode){
					this.domNode.replaceChild(this._progNode, this.iconNode);
				}else{
					domConstruct.place(this._progNode, this._findRef("icon"), "before");
				}
				prog.start();
			}else{
				if(this.iconNode){
					this.domNode.replaceChild(this.iconNode, this._progNode);
				}else{
					this.domNode.removeChild(this._progNode);
				}
				prog.stop();
			}
			this._set("busy", busy);
		},

		_setSelectedAttr: function(/*Boolean*/selected){
			// summary:
			//		Makes this widget in the selected or unselected state.
			// tags:
			//		private
			this.inherited(arguments);
			domClass.toggle(this.domNode, this._selClass, selected);
		}
	});
	
	ListItem.ChildWidgetProperties = {
		// summary:
		//		These properties can be specified for the children of a dojox/mobile/ListItem.

		// layout: String
		//		Specifies the position of the ListItem child ("left", "center" or "right").
		layout: "",
		// preventTouch: Boolean
		//		Disables touch events on the ListItem child.
		preventTouch: false
	};
	
	// Since any widget can be specified as a ListItem child, mix ChildWidgetProperties
	// into the base widget class.  (This is a hack, but it's effective.)
	// This is for the benefit of the parser.   Remove for 2.0.  Also, hide from doc viewer.
	lang.extend(WidgetBase, /*===== {} || =====*/ ListItem.ChildWidgetProperties);

	return ListItem;
});

},
'dojox/mobile/ScrollableView':function(){
define([
	"dojo/_base/array",
	"dojo/_base/declare",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dijit/registry",	// registry.byNode
	"./View",
	"./_ScrollableMixin"
], function(array, declare, domClass, domConstruct, registry, View, ScrollableMixin){

	// module:
	//		dojox/mobile/ScrollableView

	return declare("dojox.mobile.ScrollableView", [View, ScrollableMixin], {
		// summary:
		//		A container that has a touch scrolling capability.
		// description:
		//		ScrollableView is a subclass of View (dojox/mobile/View).
		//		Unlike the base View class, ScrollableView's domNode always stays
		//		at the top of the screen and its height is "100%" of the screen.
		//		Inside this fixed domNode, the containerNode scrolls. The browser's
		//		default scrolling behavior is disabled, and the scrolling mechanism is
		//		reimplemented in JavaScript. Thus the user does not need to use the
		//		two-finger operation to scroll the inner DIV (containerNode).
		//		The main purpose of this widget is to realize fixed-positioned header
		//		and/or footer bars.

		// scrollableParams: Object
		//		Parameters for dojox/mobile/scrollable.init().
		scrollableParams: null,

		// keepScrollPos: Boolean
		//		Overrides dojox/mobile/View/keepScrollPos.
		keepScrollPos: false,

		constructor: function(){
			// summary:
			//		Creates a new instance of the class.
			this.scrollableParams = {noResize: true};
		},

		buildRendering: function(){
			this.inherited(arguments);
			domClass.add(this.domNode, "mblScrollableView");
			this.domNode.style.overflow = "hidden";
			this.domNode.style.top = "0px";
			this.containerNode = domConstruct.create("div",
				{className:"mblScrollableViewContainer"}, this.domNode);
			this.containerNode.style.position = "absolute";
			this.containerNode.style.top = "0px"; // view bar is relative
			if(this.scrollDir === "v"){
				this.containerNode.style.width = "100%";
			}
		},

		startup: function(){
			if(this._started){ return; }
			this.reparent();
			this.inherited(arguments);
		},

		resize: function(){
			// summary:
			//		Calls resize() of each child widget.
			this.inherited(arguments); // scrollable#resize() will be called
			array.forEach(this.getChildren(), function(child){
				if(child.resize){ child.resize(); }
			});
		},

		isTopLevel: function(/*Event*/e){
			// summary:
			//		Returns true if this is a top-level widget.
			//		Overrides dojox/mobile/scrollable.isTopLevel.
			var parent = this.getParent && this.getParent();
			return (!parent || !parent.resize); // top level widget
		},

		addFixedBar: function(/*Widget*/widget){
			// summary:
			//		Adds a view local fixed bar to this widget.
			// description:
			//		This method can be used to programmatically add a view local
			//		fixed bar to ScrollableView. The bar is appended to this
			//		widget's domNode. The addChild API cannot be used for this
			//		purpose, because it adds the given widget to containerNode.
			var c = widget.domNode;
			var fixed = this.checkFixedBar(c, true);
			if(!fixed){ return; }
			// Fixed bar has to be added to domNode, not containerNode.
			this.domNode.appendChild(c);
			if(fixed === "top"){
				this.fixedHeaderHeight = c.offsetHeight;
				this.isLocalHeader = true;
			}else if(fixed === "bottom"){
				this.fixedFooterHeight = c.offsetHeight;
				this.isLocalFooter = true;
				c.style.bottom = "0px";
			}
			this.resize();
		},

		reparent: function(){
			// summary:
			//		Moves all the children, except header and footer, to
			//		containerNode.
			var i, idx, len, c;
			for(i = 0, idx = 0, len = this.domNode.childNodes.length; i < len; i++){
				c = this.domNode.childNodes[idx];
				// search for view-specific header or footer
				if(c === this.containerNode || this.checkFixedBar(c, true)){
					idx++;
					continue;
				}
				this.containerNode.appendChild(this.domNode.removeChild(c));
			}
		},

		onAfterTransitionIn: function(moveTo, dir, transition, context, method){
			// summary:
			//		Overrides View.onAfterTransitionIn to flash the scroll bar
			//		after performing a view transition.
			this.flashScrollBar();
		},

		getChildren: function(){
			// summary:
			//		Overrides _WidgetBase.getChildren to add local fixed bars,
			//		which are not under containerNode, to the children array.
			var children = this.inherited(arguments);
			if(this.fixedHeader && this.fixedHeader.parentNode === this.domNode){
				children.push(registry.byNode(this.fixedHeader));
			}
			if(this.fixedFooter && this.fixedFooter.parentNode === this.domNode){
				children.push(registry.byNode(this.fixedFooter));
			}
			return children;
		}
	});
});

},
'dojox/mobile/_ScrollableMixin':function(){
define([
	"dojo/_base/kernel",
	"dojo/_base/config",
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/window",
	"dojo/dom",
	"dojo/dom-class",
	"dijit/registry",	// registry.byNode
	"./scrollable"
], function(dojo, config, declare, lang, win, dom, domClass, registry, Scrollable){
	// module:
	//		dojox/mobile/_ScrollableMixin

	var cls = declare("dojox.mobile._ScrollableMixin", Scrollable, {
		// summary:
		//		Mixin for widgets to have a touch scrolling capability.
	
		// fixedHeader: String
		//		Id of the fixed header.
		fixedHeader: "",

		// fixedFooter: String
		//		Id of the fixed footer.
		fixedFooter: "",

		// scrollableParams: Object
		//		Parameters for dojox/mobile/scrollable.init().
		scrollableParams: null,

		// allowNestedScrolls: Boolean
		//		Flag to allow scrolling in nested containers, e.g. to allow ScrollableView in a SwapView.
		allowNestedScrolls: true,

		// appBars: Boolean
		//		Enables the search for application-specific bars (header or footer).
		appBars: true, 

		constructor: function(){
			// summary:
			//		Creates a new instance of the class.
			// tags:
			//		private
			this.scrollableParams = {};
		},

		destroy: function(){
			this.cleanup();
			this.inherited(arguments);
		},

		startup: function(){
			if(this._started){ return; }
			this.findAppBars();
			var node, params = this.scrollableParams;
			if(this.fixedHeader){
				node = dom.byId(this.fixedHeader);
				if(node.parentNode == this.domNode){ // local footer
					this.isLocalHeader = true;
				}
				params.fixedHeaderHeight = node.offsetHeight;
			}
			if(this.fixedFooter){
				node = dom.byId(this.fixedFooter);
				if(node.parentNode == this.domNode){ // local footer
					this.isLocalFooter = true;
					node.style.bottom = "0px";
				}
				params.fixedFooterHeight = node.offsetHeight;
			}
			this.scrollType = this.scrollType || config["mblScrollableScrollType"] || 0;
			this.init(params);
			if(this.allowNestedScrolls){
				for(var p = this.getParent(); p; p = p.getParent()){
					if(p && p.scrollableParams){
						this.dirLock = true;
						p.dirLock = true;
						break;
					}
				}
			}
			// subscribe to afterResizeAll to scroll the focused input field into view
			// so as not to break layout on orientation changes while keyboard is shown (#14991)
			this._resizeHandle = this.subscribe("/dojox/mobile/afterResizeAll", function(){
				if(this.domNode.style.display === 'none'){ return; }
				var elem = win.doc.activeElement;
				if(this.isFormElement(elem) && dom.isDescendant(elem, this.containerNode)){
					this.scrollIntoView(elem);
				}
			});
			this.inherited(arguments);
		},

		findAppBars: function(){
			// summary:
			//		Search for application-specific header or footer.
			if(!this.appBars){ return; }
			var i, len, c;
			for(i = 0, len = win.body().childNodes.length; i < len; i++){
				c = win.body().childNodes[i];
				this.checkFixedBar(c, false);
			}
			if(this.domNode.parentNode){
				for(i = 0, len = this.domNode.parentNode.childNodes.length; i < len; i++){
					c = this.domNode.parentNode.childNodes[i];
					this.checkFixedBar(c, false);
				}
			}
			this.fixedFooterHeight = this.fixedFooter ? this.fixedFooter.offsetHeight : 0;
		},

		checkFixedBar: function(/*DomNode*/node, /*Boolean*/local){
			// summary:
			//		Checks if the given node is a fixed bar or not.
			if(node.nodeType === 1){
				var fixed = node.getAttribute("fixed")
					|| (registry.byNode(node) && registry.byNode(node).fixed);
				if(fixed === "top"){
					domClass.add(node, "mblFixedHeaderBar");
					if(local){
						node.style.top = "0px";
						this.fixedHeader = node;
					}
					return fixed;
				}else if(fixed === "bottom"){
					domClass.add(node, "mblFixedBottomBar");
					this.fixedFooter = node;
					return fixed;
				}
			}
			return null;
		}
	});
	return cls;
});

},
'dojox/mobile/scrollable':function(){
define([
	"dojo/_base/kernel",
	"dojo/_base/connect",
	"dojo/_base/event",
	"dojo/_base/lang",
	"dojo/_base/window",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/dom-style",
	"./sniff"
], function(dojo, connect, event, lang, win, domClass, domConstruct, domStyle, has){

	// module:
	//		dojox/mobile/scrollable

	// TODO: rename to Scrollable.js (capital S) for 2.0

	// TODO: shouldn't be referencing this dojox/mobile variable, would be better to require the mobile.js module
	var dm = lang.getObject("dojox.mobile", true);

	// feature detection
	has.add("translate3d", function(){
		if(has("webkit")){
			var elem = win.doc.createElement("div");
			elem.style.webkitTransform = "translate3d(0px,1px,0px)";
			win.doc.documentElement.appendChild(elem);
			var v = win.doc.defaultView.getComputedStyle(elem, '')["-webkit-transform"];
			var hasTranslate3d = v && v.indexOf("matrix") === 0;
			win.doc.documentElement.removeChild(elem);
			return hasTranslate3d;
		}
	});

	var Scrollable = function(){
		// summary:
		//		Mixin for enabling touch scrolling capability.
		// description:
		//		Mixin for enabling touch scrolling capability.
		//		Mobile WebKit browsers do not allow scrolling inner DIVs. (For instance,
		//		on iOS you need the two-finger operation to scroll them.)
		//		That means you cannot have fixed-positioned header/footer bars.
		//		To solve this issue, this module disables the browsers default scrolling
		//		behavior, and rebuilds its own scrolling machinery by handling touch
		//		events. In this module, this.domNode has height "100%" and is fixed to
		//		the window, and this.containerNode scrolls. If you place a bar outside
		//		of this.containerNode, then it will be fixed-positioned while
		//		this.containerNode is scrollable.
		//
		//		This module has the following features:
		//
		//		- Scrolls inner DIVs vertically, horizontally, or both.
		//		- Vertical and horizontal scroll bars.
		//		- Flashes the scroll bars when a view is shown.
		//		- Simulates the flick operation using animation.
		//		- Respects header/footer bars if any.
	};

	lang.extend(Scrollable, {
		// fixedHeaderHeight: Number
		//		height of a fixed header
		fixedHeaderHeight: 0,

		// fixedFooterHeight: Number
		//		height of a fixed footer
		fixedFooterHeight: 0,

		// isLocalFooter: Boolean
		//		footer is view-local (as opposed to application-wide)
		isLocalFooter: false,

		// scrollBar: Boolean
		//		show scroll bar or not
		scrollBar: true,

		// scrollDir: String
		//		v: vertical, h: horizontal, vh: both, f: flip
		scrollDir: "v",

		// weight: Number
		//		frictional drag
		weight: 0.6,

		// fadeScrollBar: Boolean
		fadeScrollBar: true,

		// disableFlashScrollBar: Boolean
		disableFlashScrollBar: false,

		// threshold: Number
		//		drag threshold value in pixels
		threshold: 4,

		// constraint: Boolean
		//		bounce back to the content area
		constraint: true,

		// touchNode: DOMNode
		//		a node that will have touch event handlers
		touchNode: null,

		// propagatable: Boolean
		//		let touchstart event propagate up
		propagatable: true,

		// dirLock: Boolean
		//		disable the move handler if scroll starts in the unexpected direction
		dirLock: false,

		// height: String
		//		explicitly specified height of this widget (ex. "300px")
		height: "",

		// scrollType: Number
		//		- 1: use -webkit-transform:translate3d(x,y,z) style, use -webkit-animation for slide anim
		//		- 2: use top/left style,
		//		- 3: use -webkit-transform:translate3d(x,y,z) style, use -webkit-transition for slide anim
		//		- 0: use default value (2 in case of Android < 3, 3 if iOS6, otherwise 1)
		scrollType: 0,

		init: function(/*Object?*/params){
			// summary:
			//		Initialize according to the given params.
			// description:
			//		Mixes in the given params into this instance. At least domNode
			//		and containerNode have to be given.
			//		Starts listening to the touchstart events.
			//		Calls resize(), if this widget is a top level widget.
			if(params){
				for(var p in params){
					if(params.hasOwnProperty(p)){
						this[p] = ((p == "domNode" || p == "containerNode") && typeof params[p] == "string") ?
							win.doc.getElementById(params[p]) : params[p]; // mix-in params
					}
				}
			}
			this.touchNode = this.touchNode || this.containerNode;
			this._v = (this.scrollDir.indexOf("v") != -1); // vertical scrolling
			this._h = (this.scrollDir.indexOf("h") != -1); // horizontal scrolling
			this._f = (this.scrollDir == "f"); // flipping views

			this._ch = []; // connect handlers
			this._ch.push(connect.connect(this.touchNode,
				has('touch') ? "ontouchstart" : "onmousedown", this, "onTouchStart"));
			if(has("webkit")){
				// flag for whether to use -webkit-transform:translate3d(x,y,z) or top/left style.
				// top/left style works fine as a workaround for input fields auto-scrolling issue,
				// so use top/left in case of Android by default.
				this._useTopLeft = this.scrollType ? this.scrollType === 2 : has('android') < 3;
				// Flag for using webkit transition on transform, instead of animation + keyframes.
				// (keyframes create a slight delay before the slide animation...)
				if(!this._useTopLeft){
					this._useTransformTransition = this.scrollType ? this.scrollType === 3 : has('iphone') >= 6;
				}
				if(!this._useTopLeft){
					if(this._useTransformTransition){
						this._ch.push(connect.connect(this.domNode, "webkitTransitionEnd", this, "onFlickAnimationEnd"));
						this._ch.push(connect.connect(this.domNode, "webkitTransitionStart", this, "onFlickAnimationStart"));
					}else{
						this._ch.push(connect.connect(this.domNode, "webkitAnimationEnd", this, "onFlickAnimationEnd"));
						this._ch.push(connect.connect(this.domNode, "webkitAnimationStart", this, "onFlickAnimationStart"));
	
						// Creation of keyframes takes a little time. If they are created
						// in a lazy manner, a slight delay is noticeable when you start
						// scrolling for the first time. This is to create keyframes up front.
						for(var i = 0; i < 3; i++){
							this.setKeyframes(null, null, i);
						}
					}
					if(has("translate3d")){ // workaround for flicker issue on iPhone and Android 3.x/4.0
						domStyle.set(this.containerNode, "webkitTransform", "translate3d(0,0,0)");
					}
				}else{
					this._ch.push(connect.connect(this.domNode, "webkitTransitionEnd", this, "onFlickAnimationEnd"));
					this._ch.push(connect.connect(this.domNode, "webkitTransitionStart", this, "onFlickAnimationStart"));
				}
			}

			this._speed = {x:0, y:0};
			this._appFooterHeight = 0;
			if(this.isTopLevel() && !this.noResize){
				this.resize();
			}
			var _this = this;
			setTimeout(function(){
				_this.flashScrollBar();
			}, 600);
		},

		isTopLevel: function(){
			// summary:
			//		Returns true if this is a top-level widget.
			// description:
			//		Subclass may want to override.
			return true;
		},

		cleanup: function(){
			// summary:
			//		Uninitialize the module.
			if(this._ch){
				for(var i = 0; i < this._ch.length; i++){
					connect.disconnect(this._ch[i]);
				}
				this._ch = null;
			}
		},

		findDisp: function(/*DomNode*/node){
			// summary:
			//		Finds the currently displayed view node from my sibling nodes.
			if(!node.parentNode){ return null; }

			// the given node is the first candidate
			if(node.nodeType === 1 && domClass.contains(node, "mblSwapView") && node.style.display !== "none"){
				return node;
			}

			var nodes = node.parentNode.childNodes;
			for(var i = 0; i < nodes.length; i++){
				var n = nodes[i];
				if(n.nodeType === 1 && domClass.contains(n, "mblView") && n.style.display !== "none"){
					return n;
				}
			}
			return node;
		},

		getScreenSize: function(){
			// summary:
			//		Returns the dimensions of the browser window.
			return {
				h: win.global.innerHeight||win.doc.documentElement.clientHeight||win.doc.documentElement.offsetHeight,
				w: win.global.innerWidth||win.doc.documentElement.clientWidth||win.doc.documentElement.offsetWidth
			};
		},

		resize: function(e){
			// summary:
			//		Adjusts the height of the widget.
			// description:
			//		If the height property is 'inherit', the height is inherited
			//		from its offset parent. If 'auto', the content height, which
			//		could be smaller than the entire screen height, is used. If an
			//		explicit height value (ex. "300px"), it is used as the new
			//		height. If nothing is specified as the height property, from the
			//		current top position of the widget to the bottom of the screen
			//		will be the new height.

			// moved from init() to support dynamically added fixed bars
			this._appFooterHeight = (this.fixedFooterHeight && !this.isLocalFooter) ?
				this.fixedFooterHeight : 0;
			if(this.isLocalHeader){
				this.containerNode.style.marginTop = this.fixedHeaderHeight + "px";
			}

			// Get the top position. Same as dojo.position(node, true).y
			var top = 0;
			for(var n = this.domNode; n && n.tagName != "BODY"; n = n.offsetParent){
				n = this.findDisp(n); // find the first displayed view node
				if(!n){ break; }
				top += n.offsetTop;
			}

			// adjust the height of this view
			var	h,
				screenHeight = this.getScreenSize().h,
				dh = screenHeight - top - this._appFooterHeight; // default height
			if(this.height === "inherit"){
				if(this.domNode.offsetParent){
					h = this.domNode.offsetParent.offsetHeight + "px";
				}
			}else if(this.height === "auto"){
				var parent = this.domNode.offsetParent;
				if(parent){
					this.domNode.style.height = "0px";
					var	parentRect = parent.getBoundingClientRect(),
						scrollableRect = this.domNode.getBoundingClientRect(),
						contentBottom = parentRect.bottom - this._appFooterHeight;
					if(scrollableRect.bottom >= contentBottom){ // use entire screen
						dh = screenHeight - (scrollableRect.top - parentRect.top) - this._appFooterHeight;
					}else{ // stretch to fill predefined area
						dh = contentBottom - scrollableRect.bottom;
					}
				}
				// content could be smaller than entire screen height
				var contentHeight = Math.max(this.domNode.scrollHeight, this.containerNode.scrollHeight);
				h = (contentHeight ? Math.min(contentHeight, dh) : dh) + "px";
			}else if(this.height){
				h = this.height;
			}
			if(!h){
				h = dh + "px";
			}
			if(h.charAt(0) !== "-" && // to ensure that h is not negative (e.g. "-10px")
				h !== "default"){
				this.domNode.style.height = h;
			}

			// to ensure that the view is within a scrolling area when resized.
			this.onTouchEnd();
		},

		onFlickAnimationStart: function(e){
			event.stop(e);
		},

		onFlickAnimationEnd: function(e){
			var an = e && e.animationName;
			if(an && an.indexOf("scrollableViewScroll2") === -1){
				if(an.indexOf("scrollableViewScroll0") !== -1){ // scrollBarV
					if(this._scrollBarNodeV){ domClass.remove(this._scrollBarNodeV, "mblScrollableScrollTo0"); }
				}else if(an.indexOf("scrollableViewScroll1") !== -1){ // scrollBarH
					if(this._scrollBarNodeH){ domClass.remove(this._scrollBarNodeH, "mblScrollableScrollTo1"); }
				}else{ // fade or others
					if(this._scrollBarNodeV){ this._scrollBarNodeV.className = ""; }
					if(this._scrollBarNodeH){ this._scrollBarNodeH.className = ""; }
				}
				return;
			}
			if(this._useTransformTransition || this._useTopLeft){
				var n = e.target;
				if(n === this._scrollBarV || n === this._scrollBarH){
					var cls = "mblScrollableScrollTo" + (n === this._scrollBarV ? "0" : "1");
					if(domClass.contains(n, cls)){
						domClass.remove(n, cls);
					}else{
						n.className = "";
					}
					return;
				}
			}
			if(e && e.srcElement){
				event.stop(e);
			}
			this.stopAnimation();
			if(this._bounce){
				var _this = this;
				var bounce = _this._bounce;
				setTimeout(function(){
					_this.slideTo(bounce, 0.3, "ease-out");
				}, 0);
				_this._bounce = undefined;
			}else{
				this.hideScrollBar();
				this.removeCover();
			}
		},

		isFormElement: function(/*DOMNode*/node){
			// summary:
			//		Returns true if the given node is a form control.
			if(node && node.nodeType !== 1){ node = node.parentNode; }
			if(!node || node.nodeType !== 1){ return false; }
			var t = node.tagName;
			return (t === "SELECT" || t === "INPUT" || t === "TEXTAREA" || t === "BUTTON");
		},

		onTouchStart: function(e){
			// summary:
			//		User-defined function to handle touchStart events.
			if(this.disableTouchScroll){ return; }
			if(this._conn && (new Date()).getTime() - this.startTime < 500){
				return; // ignore successive onTouchStart calls
			}
			if(!this._conn){
				this._conn = [];
				this._conn.push(connect.connect(win.doc, has('touch') ? "ontouchmove" : "onmousemove", this, "onTouchMove"));
				this._conn.push(connect.connect(win.doc, has('touch') ? "ontouchend" : "onmouseup", this, "onTouchEnd"));
			}

			this._aborted = false;
			if(domClass.contains(this.containerNode, "mblScrollableScrollTo2")){
				this.abort();
			}else{ // reset scrollbar class especially for reseting fade-out animation
				if(this._scrollBarNodeV){ this._scrollBarNodeV.className = ""; }
				if(this._scrollBarNodeH){ this._scrollBarNodeH.className = ""; }
			}
			this.touchStartX = e.touches ? e.touches[0].pageX : e.clientX;
			this.touchStartY = e.touches ? e.touches[0].pageY : e.clientY;
			this.startTime = (new Date()).getTime();
			this.startPos = this.getPos();
			this._dim = this.getDim();
			this._time = [0];
			this._posX = [this.touchStartX];
			this._posY = [this.touchStartY];
			this._locked = false;

			if(!this.isFormElement(e.target)){
				this.propagatable ? e.preventDefault() : event.stop(e);
			}
		},

		onTouchMove: function(e){
			// summary:
			//		User-defined function to handle touchMove events.
			if(this._locked){ return; }
			var x = e.touches ? e.touches[0].pageX : e.clientX;
			var y = e.touches ? e.touches[0].pageY : e.clientY;
			var dx = x - this.touchStartX;
			var dy = y - this.touchStartY;
			var to = {x:this.startPos.x + dx, y:this.startPos.y + dy};
			var dim = this._dim;

			dx = Math.abs(dx);
			dy = Math.abs(dy);
			if(this._time.length == 1){ // the first TouchMove after TouchStart
				if(this.dirLock){
					if(this._v && !this._h && dx >= this.threshold && dx >= dy ||
						(this._h || this._f) && !this._v && dy >= this.threshold && dy >= dx){
						this._locked = true;
						return;
					}
				}
				if(this._v && this._h){ // scrollDir="hv"
					if(dy < this.threshold &&
					   dx < this.threshold){
						return;
					}
				}else{
					if(this._v && dy < this.threshold ||
					   (this._h || this._f) && dx < this.threshold){
						return;
					}
				}
				this.addCover();
				this.showScrollBar();
			}

			var weight = this.weight;
			if(this._v && this.constraint){
				if(to.y > 0){ // content is below the screen area
					to.y = Math.round(to.y * weight);
				}else if(to.y < -dim.o.h){ // content is above the screen area
					if(dim.c.h < dim.d.h){ // content is shorter than display
						to.y = Math.round(to.y * weight);
					}else{
						to.y = -dim.o.h - Math.round((-dim.o.h - to.y) * weight);
					}
				}
			}
			if((this._h || this._f) && this.constraint){
				if(to.x > 0){
					to.x = Math.round(to.x * weight);
				}else if(to.x < -dim.o.w){
					if(dim.c.w < dim.d.w){
						to.x = Math.round(to.x * weight);
					}else{
						to.x = -dim.o.w - Math.round((-dim.o.w - to.x) * weight);
					}
				}
			}
			this.scrollTo(to);

			var max = 10;
			var n = this._time.length; // # of samples
			if(n >= 2){
				// Check the direction of the finger move.
				// If the direction has been changed, discard the old data.
				var d0, d1;
				if(this._v && !this._h){
					d0 = this._posY[n - 1] - this._posY[n - 2];
					d1 = y - this._posY[n - 1];
				}else if(!this._v && this._h){
					d0 = this._posX[n - 1] - this._posX[n - 2];
					d1 = x - this._posX[n - 1];
				}
				if(d0 * d1 < 0){ // direction changed
					// leave only the latest data
					this._time = [this._time[n - 1]];
					this._posX = [this._posX[n - 1]];
					this._posY = [this._posY[n - 1]];
					n = 1;
				}
			}
			if(n == max){
				this._time.shift();
				this._posX.shift();
				this._posY.shift();
			}
			this._time.push((new Date()).getTime() - this.startTime);
			this._posX.push(x);
			this._posY.push(y);
		},

		onTouchEnd: function(/*Event*/e){
			// summary:
			//		User-defined function to handle touchEnd events.
			if(this._locked){ return; }
			var speed = this._speed = {x:0, y:0};
			var dim = this._dim;
			var pos = this.getPos();
			var to = {}; // destination
			if(e){
				if(!this._conn){ return; } // if we get onTouchEnd without onTouchStart, ignore it.
				for(var i = 0; i < this._conn.length; i++){
					connect.disconnect(this._conn[i]);
				}
				this._conn = null;

				var n = this._time.length; // # of samples
				var clicked = false;
				if(!this._aborted){
					if(n <= 1){
						clicked = true;
					}else if(n == 2 && Math.abs(this._posY[1] - this._posY[0]) < 4
						&& has('touch')){ // for desktop browsers, posY could be the same, since we're using clientY, see onTouchMove()
						clicked = true;
					}
				}
				if(clicked){ // clicked, not dragged or flicked
					this.hideScrollBar();
					this.removeCover();
					// #12697 Do not generate a click event programmatically when a
					// form element (input, select, etc.) is clicked.
					// Otherwise, in particular, when checkbox is clicked, its state
					// is reversed again by the generated event.
					// #15878 The reason we send this synthetic click event is that we assume that the OS
					// will not send the click because we prevented/stopped the touchstart.
					// However, this does not seem true any more in Android 4.1 where the click is
					// actually sent by the OS. So we must not send it a second time.
					if(has('touch') && !this.isFormElement(e.target) && !(has("android") >= 4.1)){
						var elem = e.target;
						if(elem.nodeType != 1){
							elem = elem.parentNode;
						}
						var ev = win.doc.createEvent("MouseEvents");
						ev.initMouseEvent("click", true, true, win.global, 1, e.screenX, e.screenY, e.clientX, e.clientY);
						setTimeout(function(){
							elem.dispatchEvent(ev);
						}, 0);
					}
					return;
				}
				speed = this._speed = this.getSpeed();
			}else{
				if(pos.x == 0 && pos.y == 0){ return; } // initializing
				dim = this.getDim();
			}

			if(this._v){
				to.y = pos.y + speed.y;
			}
			if(this._h || this._f){
				to.x = pos.x + speed.x;
			}

			if(this.adjustDestination(to, pos, dim) === false){ return; }

			if(this.scrollDir == "v" && dim.c.h < dim.d.h){ // content is shorter than display
				this.slideTo({y:0}, 0.3, "ease-out"); // go back to the top
				return;
			}else if(this.scrollDir == "h" && dim.c.w < dim.d.w){ // content is narrower than display
				this.slideTo({x:0}, 0.3, "ease-out"); // go back to the left
				return;
			}else if(this._v && this._h && dim.c.h < dim.d.h && dim.c.w < dim.d.w){
				this.slideTo({x:0, y:0}, 0.3, "ease-out"); // go back to the top-left
				return;
			}

			var duration, easing = "ease-out";
			var bounce = {};
			if(this._v && this.constraint){
				if(to.y > 0){ // going down. bounce back to the top.
					if(pos.y > 0){ // started from below the screen area. return quickly.
						duration = 0.3;
						to.y = 0;
					}else{
						to.y = Math.min(to.y, 20);
						easing = "linear";
						bounce.y = 0;
					}
				}else if(-speed.y > dim.o.h - (-pos.y)){ // going up. bounce back to the bottom.
					if(pos.y < -dim.o.h){ // started from above the screen top. return quickly.
						duration = 0.3;
						to.y = dim.c.h <= dim.d.h ? 0 : -dim.o.h; // if shorter, move to 0
					}else{
						to.y = Math.max(to.y, -dim.o.h - 20);
						easing = "linear";
						bounce.y = -dim.o.h;
					}
				}
			}
			if((this._h || this._f) && this.constraint){
				if(to.x > 0){ // going right. bounce back to the left.
					if(pos.x > 0){ // started from right of the screen area. return quickly.
						duration = 0.3;
						to.x = 0;
					}else{
						to.x = Math.min(to.x, 20);
						easing = "linear";
						bounce.x = 0;
					}
				}else if(-speed.x > dim.o.w - (-pos.x)){ // going left. bounce back to the right.
					if(pos.x < -dim.o.w){ // started from left of the screen top. return quickly.
						duration = 0.3;
						to.x = dim.c.w <= dim.d.w ? 0 : -dim.o.w; // if narrower, move to 0
					}else{
						to.x = Math.max(to.x, -dim.o.w - 20);
						easing = "linear";
						bounce.x = -dim.o.w;
					}
				}
			}
			this._bounce = (bounce.x !== undefined || bounce.y !== undefined) ? bounce : undefined;

			if(duration === undefined){
				var distance, velocity;
				if(this._v && this._h){
					velocity = Math.sqrt(speed.x*speed.x + speed.y*speed.y);
					distance = Math.sqrt(Math.pow(to.y - pos.y, 2) + Math.pow(to.x - pos.x, 2));
				}else if(this._v){
					velocity = speed.y;
					distance = to.y - pos.y;
				}else if(this._h){
					velocity = speed.x;
					distance = to.x - pos.x;
				}
				if(distance === 0 && !e){ return; } // #13154
				duration = velocity !== 0 ? Math.abs(distance / velocity) : 0.01; // time = distance / velocity
			}
			this.slideTo(to, duration, easing);
		},

		adjustDestination: function(/*Object*/to, /*Object*/pos, /*Object*/dim){
			// summary:
			//		A stub function to be overridden by subclasses.
			// description:
			//		This function is called from onTouchEnd(). The purpose is to give its
			//		subclasses a chance to adjust the destination position. If this
			//		function returns false, onTouchEnd() returns immediately without
			//		performing scroll.
			// to:
			//		The destination position. An object with x and y.
			// pos:
			//		The current position. An object with x and y.
			// dim:
			//		Dimension information returned by getDim().			

			// subclass may want to implement
			return true; // Boolean
		},

		abort: function(){
			// summary:
			//		Aborts scrolling.
			// description:
			//		This function stops the scrolling animation that is currently
			//		running. It is called when the user touches the screen while
			//		scrolling.
			this.scrollTo(this.getPos());
			this.stopAnimation();
			this._aborted = true;
		},

		stopAnimation: function(){
			// summary:
			//		Stops the currently running animation.
			domClass.remove(this.containerNode, "mblScrollableScrollTo2");
			if(this._scrollBarV){
				this._scrollBarV.className = "";
			}
			if(this._scrollBarH){
				this._scrollBarH.className = "";
			}
			if(this._useTransformTransition || this._useTopLeft){
				this.containerNode.style.webkitTransition = "";
				if(this._scrollBarV) { this._scrollBarV.style.webkitTransition = ""; }
				if(this._scrollBarH) { this._scrollBarH.style.webkitTransition = ""; }
			}
		},

		scrollIntoView: function(/*DOMNode*/node, /*Boolean?*/alignWithTop, /*Number?*/duration){
			// summary:
			//		Scrolls the pane until the searching node is in the view.
			// node:
			//		A DOM node to be searched for view.
			// alignWithTop:
			//		If true, aligns the node at the top of the pane.
			//		If false, aligns the node at the bottom of the pane.
			// duration:
			//		Duration of scrolling in seconds. (ex. 0.3)
			//		If not specified, scrolls without animation.
			// description:
			//		Just like the scrollIntoView method of DOM elements, this
			//		function causes the given node to scroll into view, aligning it
			//		either at the top or bottom of the pane.

			if(!this._v){ return; } // cannot scroll vertically

			var c = this.containerNode,
				h = this.getDim().d.h, // the height of ScrollableView's content display area
				top = 0;

			// Get the top position of node relative to containerNode
			for(var n = node; n !== c; n = n.offsetParent){
				if(!n || n.tagName === "BODY"){ return; } // exit if node is not a child of scrollableView
				top += n.offsetTop;
			}
			// Calculate scroll destination position
			var y = alignWithTop ? Math.max(h - c.offsetHeight, -top) : Math.min(0, h - top - node.offsetHeight);

			// Scroll to destination position
			(duration && typeof duration === "number") ? 
				this.slideTo({y: y}, duration, "ease-out") : this.scrollTo({y: y});
		},

		getSpeed: function(){
			// summary:
			//		Returns an object that indicates the scrolling speed.
			// description:
			//		From the position and elapsed time information, calculates the
			//		scrolling speed, and returns an object with x and y.
			var x = 0, y = 0, n = this._time.length;
			// if the user holds the mouse or finger more than 0.5 sec, do not move.
			if(n >= 2 && (new Date()).getTime() - this.startTime - this._time[n - 1] < 500){
				var dy = this._posY[n - (n > 3 ? 2 : 1)] - this._posY[(n - 6) >= 0 ? n - 6 : 0];
				var dx = this._posX[n - (n > 3 ? 2 : 1)] - this._posX[(n - 6) >= 0 ? n - 6 : 0];
				var dt = this._time[n - (n > 3 ? 2 : 1)] - this._time[(n - 6) >= 0 ? n - 6 : 0];
				y = this.calcSpeed(dy, dt);
				x = this.calcSpeed(dx, dt);
			}
			return {x:x, y:y};
		},

		calcSpeed: function(/*Number*/distance, /*Number*/time){
			// summary:
			//		Calculate the speed given the distance and time.
			return Math.round(distance / time * 100) * 4;
		},

		scrollTo: function(/*Object*/to, /*Boolean?*/doNotMoveScrollBar, /*DomNode?*/node){
			// summary:
			//		Scrolls to the given position immediately without animation.
			// to:
			//		The destination position. An object with x and y.
			//		ex. {x:0, y:-5}
			// doNotMoveScrollBar:
			//		If true, the scroll bar will not be updated. If not specified,
			//		it will be updated.
			// node:
			//		A DOM node to scroll. If not specified, defaults to
			//		this.containerNode.

			var s = (node || this.containerNode).style;
			if(has("webkit")){
				if(!this._useTopLeft){
					if(this._useTransformTransition){
						s.webkitTransition = "";	
					}
					s.webkitTransform = this.makeTranslateStr(to);
				}else{
					s.webkitTransition = "";
					if(this._v){
						s.top = to.y + "px";
					}
					if(this._h || this._f){
						s.left = to.x + "px";
					}
				}
			}else{
				if(this._v){
					s.top = to.y + "px";
				}
				if(this._h || this._f){
					s.left = to.x + "px";
				}
			}
			if(!doNotMoveScrollBar){
				this.scrollScrollBarTo(this.calcScrollBarPos(to));
			}
		},

		slideTo: function(/*Object*/to, /*Number*/duration, /*String*/easing){
			// summary:
			//		Scrolls to the given position with the slide animation.
			// to:
			//		The scroll destination position. An object with x and/or y.
			//		ex. {x:0, y:-5}, {y:-29}, etc.
			// duration:
			//		Duration of scrolling in seconds. (ex. 0.3)
			// easing:
			//		The name of easing effect which webkit supports.
			//		"ease", "linear", "ease-in", "ease-out", etc.

			this._runSlideAnimation(this.getPos(), to, duration, easing, this.containerNode, 2);
			this.slideScrollBarTo(to, duration, easing);
		},

		makeTranslateStr: function(/*Object*/to){
			// summary:
			//		Constructs a string value that is passed to the -webkit-transform property.
			// to:
			//		The destination position. An object with x and/or y.
			// description:
			//		Return value example: "translate3d(0px,-8px,0px)"

			var y = this._v && typeof to.y == "number" ? to.y+"px" : "0px";
			var x = (this._h||this._f) && typeof to.x == "number" ? to.x+"px" : "0px";
			return has("translate3d") ?
					"translate3d("+x+","+y+",0px)" : "translate("+x+","+y+")";
		},

		getPos: function(){
			// summary:
			//		Gets the top position in the midst of animation.
			if(has("webkit")){
				var s = win.doc.defaultView.getComputedStyle(this.containerNode, '');
				if(!this._useTopLeft){
					var m = s["-webkit-transform"];
					if(m && m.indexOf("matrix") === 0){
						var arr = m.split(/[,\s\)]+/);
						return {y:arr[5] - 0, x:arr[4] - 0};
					}
					return {x:0, y:0};
				}else{
					return {x:parseInt(s.left) || 0, y:parseInt(s.top) || 0};
				}
			}else{
				// this.containerNode.offsetTop does not work here,
				// because it adds the height of the top margin.
				var y = parseInt(this.containerNode.style.top) || 0;
				return {y:y, x:this.containerNode.offsetLeft};
			}
		},

		getDim: function(){
			// summary:
			//		Returns various internal dimensional information needed for calculation.

			var d = {};
			// content width/height
			d.c = {h:this.containerNode.offsetHeight, w:this.containerNode.offsetWidth};

			// view width/height
			d.v = {h:this.domNode.offsetHeight + this._appFooterHeight, w:this.domNode.offsetWidth};

			// display width/height
			d.d = {h:d.v.h - this.fixedHeaderHeight - this.fixedFooterHeight, w:d.v.w};

			// overflowed width/height
			d.o = {h:d.c.h - d.v.h + this.fixedHeaderHeight + this.fixedFooterHeight, w:d.c.w - d.v.w};
			return d;
		},

		showScrollBar: function(){
			// summary:
			//		Shows the scroll bar.
			// description:
			//		This function creates the scroll bar instance if it does not
			//		exist yet, and calls resetScrollBar() to reset its length and
			//		position.

			if(!this.scrollBar){ return; }

			var dim = this._dim;
			if(this.scrollDir == "v" && dim.c.h <= dim.d.h){ return; }
			if(this.scrollDir == "h" && dim.c.w <= dim.d.w){ return; }
			if(this._v && this._h && dim.c.h <= dim.d.h && dim.c.w <= dim.d.w){ return; }

			var createBar = function(self, dir){
				var bar = self["_scrollBarNode" + dir];
				if(!bar){
					var wrapper = domConstruct.create("div", null, self.domNode);
					var props = { position: "absolute", overflow: "hidden" };
					if(dir == "V"){
						props.right = "2px";
						props.width = "5px";
					}else{
						props.bottom = (self.isLocalFooter ? self.fixedFooterHeight : 0) + 2 + "px";
						props.height = "5px";
					}
					domStyle.set(wrapper, props);
					wrapper.className = "mblScrollBarWrapper";
					self["_scrollBarWrapper"+dir] = wrapper;

					bar = domConstruct.create("div", null, wrapper);
					domStyle.set(bar, {
						opacity: 0.6,
						position: "absolute",
						backgroundColor: "#606060",
						fontSize: "1px",
						webkitBorderRadius: "2px",
						MozBorderRadius: "2px",
						webkitTransformOrigin: "0 0",
						zIndex: 2147483647 // max of signed 32-bit integer
					});
					domStyle.set(bar, dir == "V" ? {width: "5px"} : {height: "5px"});
					self["_scrollBarNode" + dir] = bar;
				}
				return bar;
			};
			if(this._v && !this._scrollBarV){
				this._scrollBarV = createBar(this, "V");
			}
			if(this._h && !this._scrollBarH){
				this._scrollBarH = createBar(this, "H");
			}
			this.resetScrollBar();
		},

		hideScrollBar: function(){
			// summary:
			//		Hides the scroll bar.
			// description:
			//		If the fadeScrollBar property is true, hides the scroll bar with
			//		the fade animation.

			if(this.fadeScrollBar && has("webkit")){
				if(!dm._fadeRule){
					var node = domConstruct.create("style", null, win.doc.getElementsByTagName("head")[0]);
					node.textContent =
						".mblScrollableFadeScrollBar{"+
						"  -webkit-animation-duration: 1s;"+
						"  -webkit-animation-name: scrollableViewFadeScrollBar;}"+
						"@-webkit-keyframes scrollableViewFadeScrollBar{"+
						"  from { opacity: 0.6; }"+
						"  to { opacity: 0; }}";
					dm._fadeRule = node.sheet.cssRules[1];
				}
			}
			if(!this.scrollBar){ return; }
			var f = function(bar, self){
				domStyle.set(bar, {
					opacity: 0,
					webkitAnimationDuration: ""
				});
				// do not use fade animation in case of using top/left on Android
				// since it causes screen flicker during adress bar's fading out
				if(!(self._useTopLeft && has('android'))){
					bar.className = "mblScrollableFadeScrollBar";
				}
			};
			if(this._scrollBarV){
				f(this._scrollBarV, this);
				this._scrollBarV = null;
			}
			if(this._scrollBarH){
				f(this._scrollBarH, this);
				this._scrollBarH = null;
			}
		},

		calcScrollBarPos: function(/*Object*/to){
			// summary:
			//		Calculates the scroll bar position.
			// description:
			//		Given the scroll destination position, calculates the top and/or
			//		the left of the scroll bar(s). Returns an object with x and y.
			// to:
			//		The scroll destination position. An object with x and y.
			//		ex. {x:0, y:-5}			

			var pos = {};
			var dim = this._dim;
			var f = function(wrapperH, barH, t, d, c){
				var y = Math.round((d - barH - 8) / (d - c) * t);
				if(y < -barH + 5){
					y = -barH + 5;
				}
				if(y > wrapperH - 5){
					y = wrapperH - 5;
				}
				return y;
			};
			if(typeof to.y == "number" && this._scrollBarV){
				pos.y = f(this._scrollBarWrapperV.offsetHeight, this._scrollBarV.offsetHeight, to.y, dim.d.h, dim.c.h);
			}
			if(typeof to.x == "number" && this._scrollBarH){
				pos.x = f(this._scrollBarWrapperH.offsetWidth, this._scrollBarH.offsetWidth, to.x, dim.d.w, dim.c.w);
			}
			return pos;
		},

		scrollScrollBarTo: function(/*Object*/to){
			// summary:
			//		Moves the scroll bar(s) to the given position without animation.
			// to:
			//		The destination position. An object with x and/or y.
			//		ex. {x:2, y:5}, {y:20}, etc.

			if(!this.scrollBar){ return; }
			if(this._v && this._scrollBarV && typeof to.y == "number"){
				if(has("webkit")){
					if(!this._useTopLeft){
						if(this._useTransformTransition){
							this._scrollBarV.style.webkitTransition = "";
						}
						this._scrollBarV.style.webkitTransform = this.makeTranslateStr({y:to.y});
					}else{
						domStyle.set(this._scrollBarV, {
							webkitTransition: "",
							top: to.y + "px"
						});
					}
				}else{
					this._scrollBarV.style.top = to.y + "px";
				}
			}
			if(this._h && this._scrollBarH && typeof to.x == "number"){
				if(has("webkit")){
					if(!this._useTopLeft){
						if(this._useTransformTransition){
							this._scrollBarH.style.webkitTransition = "";
						}
						this._scrollBarH.style.webkitTransform = this.makeTranslateStr({x:to.x});
					}else{
						domStyle.set(this._scrollBarH, {
							webkitTransition: "",
							left: to.x + "px"
						});
					}
				}else{
					this._scrollBarH.style.left = to.x + "px";
				}
			}
		},

		slideScrollBarTo: function(/*Object*/to, /*Number*/duration, /*String*/easing){
			// summary:
			//		Moves the scroll bar(s) to the given position with the slide animation.
			// to:
			//		The destination position. An object with x and y.
			//		ex. {x:0, y:-5}
			// duration:
			//		Duration of the animation in seconds. (ex. 0.3)
			// easing:
			//		The name of easing effect which webkit supports.
			//		"ease", "linear", "ease-in", "ease-out", etc.

			if(!this.scrollBar){ return; }
			var fromPos = this.calcScrollBarPos(this.getPos());
			var toPos = this.calcScrollBarPos(to);
			if(this._v && this._scrollBarV){
				this._runSlideAnimation({y:fromPos.y}, {y:toPos.y}, duration, easing, this._scrollBarV, 0);
			}
			if(this._h && this._scrollBarH){
				this._runSlideAnimation({x:fromPos.x}, {x:toPos.x}, duration, easing, this._scrollBarH, 1);
			}
		},

		_runSlideAnimation: function(/*Object*/from, /*Object*/to, /*Number*/duration, /*String*/easing, /*DomNode*/node, /*Number*/idx){
			// tags:
			//		private
			
			// idx: 0:scrollbarV, 1:scrollbarH, 2:content
			if(has("webkit")){
				if(!this._useTopLeft){
					if(this._useTransformTransition){
						// for iOS6 (maybe others?): use -webkit-transform + -webkit-transition
						if(to.x === undefined){ to.x = from.x; }
						if(to.y === undefined){ to.y = from.y; }
						 // make sure we actually change the transform, otherwise no webkitTransitionEnd is fired.
						if(to.x !== from.x || to.y !== from.y){
							domStyle.set(node, {
								webkitTransitionProperty: "-webkit-transform",
								webkitTransitionDuration: duration + "s",
								webkitTransitionTimingFunction: easing
							});
							var t = this.makeTranslateStr(to);
							setTimeout(function(){ // setTimeout is needed to prevent webkitTransitionEnd not fired
								domStyle.set(node, {
									webkitTransform: t
								});
							}, 0);
							domClass.add(node, "mblScrollableScrollTo"+idx);
						} else {
							// transform not changed, just hide the scrollbar
							this.hideScrollBar();
							this.removeCover();
						}
					}else{
						// use -webkit-transform + -webkit-animation
						this.setKeyframes(from, to, idx);
						domStyle.set(node, {
							webkitAnimationDuration: duration + "s",
							webkitAnimationTimingFunction: easing
						});
						domClass.add(node, "mblScrollableScrollTo"+idx);
						if(idx == 2){
							this.scrollTo(to, true, node);
						}else{
							this.scrollScrollBarTo(to);
						}
					}
				}else{
					domStyle.set(node, {
						webkitTransitionProperty: "top, left",
						webkitTransitionDuration: duration + "s",
						webkitTransitionTimingFunction: easing
					});
					setTimeout(function(){ // setTimeout is needed to prevent webkitTransitionEnd not fired
						domStyle.set(node, {
							top: (to.y || 0) + "px",
							left: (to.x || 0) + "px"
						});
					}, 0);
					domClass.add(node, "mblScrollableScrollTo"+idx);
				}
			}else if(dojo.fx && dojo.fx.easing && duration){
				// If you want to support non-webkit browsers,
				// your application needs to load necessary modules as follows:
				//
				// | dojo.require("dojo.fx");
				// | dojo.require("dojo.fx.easing");
				//
				// This module itself does not make dependency on them.
				// TODO: for 2.0 the dojo global is going away.   Use require("dojo/fx") and require("dojo/fx/easing") instead.
				var s = dojo.fx.slideTo({
					node: node,
					duration: duration*1000,
					left: to.x,
					top: to.y,
					easing: (easing == "ease-out") ? dojo.fx.easing.quadOut : dojo.fx.easing.linear
				}).play();
				if(idx == 2){
					connect.connect(s, "onEnd", this, "onFlickAnimationEnd");
				}
			}else{
				// directly jump to the destination without animation
				if(idx == 2){
					this.scrollTo(to, false, node);
					this.onFlickAnimationEnd();
				}else{
					this.scrollScrollBarTo(to);
				}
			}
		},

		resetScrollBar: function(){
			// summary:
			//		Resets the scroll bar length, position, etc.
			var f = function(wrapper, bar, d, c, hd, v){
				if(!bar){ return; }
				var props = {};
				props[v ? "top" : "left"] = hd + 4 + "px"; // +4 is for top or left margin
				var t = (d - 8) <= 0 ? 1 : d - 8;
				props[v ? "height" : "width"] = t + "px";
				domStyle.set(wrapper, props);
				var l = Math.round(d * d / c); // scroll bar length
				l = Math.min(Math.max(l - 8, 5), t); // -8 is for margin for both ends
				bar.style[v ? "height" : "width"] = l + "px";
				domStyle.set(bar, {"opacity": 0.6});
			};
			var dim = this.getDim();
			f(this._scrollBarWrapperV, this._scrollBarV, dim.d.h, dim.c.h, this.fixedHeaderHeight, true);
			f(this._scrollBarWrapperH, this._scrollBarH, dim.d.w, dim.c.w, 0);
			this.createMask();
		},

		createMask: function(){
			// summary:
			//		Creates a mask for a scroll bar edge.
			// description:
			//		This function creates a mask that hides corners of one scroll
			//		bar edge to make it round edge. The other side of the edge is
			//		always visible and round shaped with the border-radius style.
			if(!has("webkit")){ return; }
			var ctx;
			if(this._scrollBarWrapperV){
				var h = this._scrollBarWrapperV.offsetHeight;
				ctx = win.doc.getCSSCanvasContext("2d", "scrollBarMaskV", 5, h);
				ctx.fillStyle = "rgba(0,0,0,0.5)";
				ctx.fillRect(1, 0, 3, 2);
				ctx.fillRect(0, 1, 5, 1);
				ctx.fillRect(0, h - 2, 5, 1);
				ctx.fillRect(1, h - 1, 3, 2);
				ctx.fillStyle = "rgb(0,0,0)";
				ctx.fillRect(0, 2, 5, h - 4);
				this._scrollBarWrapperV.style.webkitMaskImage = "-webkit-canvas(scrollBarMaskV)";
			}
			if(this._scrollBarWrapperH){
				var w = this._scrollBarWrapperH.offsetWidth;
				ctx = win.doc.getCSSCanvasContext("2d", "scrollBarMaskH", w, 5);
				ctx.fillStyle = "rgba(0,0,0,0.5)";
				ctx.fillRect(0, 1, 2, 3);
				ctx.fillRect(1, 0, 1, 5);
				ctx.fillRect(w - 2, 0, 1, 5);
				ctx.fillRect(w - 1, 1, 2, 3);
				ctx.fillStyle = "rgb(0,0,0)";
				ctx.fillRect(2, 0, w - 4, 5);
				this._scrollBarWrapperH.style.webkitMaskImage = "-webkit-canvas(scrollBarMaskH)";
			}
		},

		flashScrollBar: function(){
			// summary:
			//		Shows the scroll bar instantly.
			// description:
			//		This function shows the scroll bar, and then hides it 300ms
			//		later. This is used to show the scroll bar to the user for a
			//		short period of time when a hidden view is revealed.
			if(this.disableFlashScrollBar || !this.domNode){ return; }
			this._dim = this.getDim();
			if(this._dim.d.h <= 0){ return; } // dom is not ready
			this.showScrollBar();
			var _this = this;
			setTimeout(function(){
				_this.hideScrollBar();
			}, 300);
		},

		addCover: function(){
			// summary:
			//		Adds the transparent DIV cover.
			// description:
			//		The cover is to prevent DOM events from affecting the child
			//		widgets such as a list widget. Without the cover, for example,
			//		child widgets may receive a click event and respond to it
			//		unexpectedly when the user flicks the screen to scroll.
			//		Note that only the desktop browsers need the cover.

			if(!has('touch') && !this.noCover){
				if(!dm._cover){
					dm._cover = domConstruct.create("div", null, win.doc.body);
					dm._cover.className = "mblScrollableCover";
					domStyle.set(dm._cover, {
						backgroundColor: "#ffff00",
						opacity: 0,
						position: "absolute",
						top: "0px",
						left: "0px",
						width: "100%",
						height: "100%",
						zIndex: 2147483647 // max of signed 32-bit integer
					});
					this._ch.push(connect.connect(dm._cover,
						has('touch') ? "ontouchstart" : "onmousedown", this, "onTouchEnd"));
				}else{
					dm._cover.style.display = "";
				}
				this.setSelectable(dm._cover, false);
				this.setSelectable(this.domNode, false);
			}
		},

		removeCover: function(){
			// summary:
			//		Removes the transparent DIV cover.

			if(!has('touch') && dm._cover){
				dm._cover.style.display = "none";
				this.setSelectable(dm._cover, true);
				this.setSelectable(this.domNode, true);
			}
		},

		setKeyframes: function(/*Object*/from, /*Object*/to, /*Number*/idx){
			// summary:
			//		Programmatically sets key frames for the scroll animation.

			if(!dm._rule){
				dm._rule = [];
			}
			// idx: 0:scrollbarV, 1:scrollbarH, 2:content
			if(!dm._rule[idx]){
				var node = domConstruct.create("style", null, win.doc.getElementsByTagName("head")[0]);
				node.textContent =
					".mblScrollableScrollTo"+idx+"{-webkit-animation-name: scrollableViewScroll"+idx+";}"+
					"@-webkit-keyframes scrollableViewScroll"+idx+"{}";
				dm._rule[idx] = node.sheet.cssRules[1];
			}
			var rule = dm._rule[idx];
			if(rule){
				if(from){
					rule.deleteRule("from");
					rule.insertRule("from { -webkit-transform: "+this.makeTranslateStr(from)+"; }");
				}
				if(to){
					if(to.x === undefined){ to.x = from.x; }
					if(to.y === undefined){ to.y = from.y; }
					rule.deleteRule("to");
					rule.insertRule("to { -webkit-transform: "+this.makeTranslateStr(to)+"; }");
				}
			}
		},

		setSelectable: function(/*DomNode*/node, /*Boolean*/selectable){
			// summary:
			//		Sets the given node as selectable or unselectable.
			 
			// dojo.setSelectable has dependency on dojo.query. Redefine our own.
			node.style.KhtmlUserSelect = selectable ? "auto" : "none";
			node.style.MozUserSelect = selectable ? "" : "none";
			node.onselectstart = selectable ? null : function(){return false;};
			if(has("ie")){
				node.unselectable = selectable ? "" : "on";
				var nodes = node.getElementsByTagName("*");
				for(var i = 0; i < nodes.length; i++){
					nodes[i].unselectable = selectable ? "" : "on";
				}
			}
		}
	});

	lang.setObject("dojox.mobile.scrollable", Scrollable);

	return Scrollable;
});

},
'dojox/mobile/RoundRectCategory':function(){
define([
	"dojo/_base/declare",
	"dojo/_base/window",
	"dojo/dom-construct",
	"dijit/_Contained",
	"dijit/_WidgetBase"
], function(declare, win, domConstruct, Contained, WidgetBase){

	// module:
	//		dojox/mobile/RoundRectCategory

	return declare("dojox.mobile.RoundRectCategory", [WidgetBase, Contained], {
		// summary:
		//		A category header for a rounded rectangle list.

		// label: String
		//		A label of the category. If the label is not specified,
		//		innerHTML is used as a label.
		label: "",

		// tag: String
		//		A name of html tag to create as domNode.
		tag: "h2",

		/* internal properties */	
		
		// baseClass: String
		//		The name of the CSS class of this widget.
		baseClass: "mblRoundRectCategory",

		buildRendering: function(){
			var domNode = this.domNode = this.containerNode = this.srcNodeRef || domConstruct.create(this.tag);
			this.inherited(arguments);
			if(!this.label && domNode.childNodes.length === 1 && domNode.firstChild.nodeType === 3){
				// if it has only one text node, regard it as a label
				this.label = domNode.firstChild.nodeValue;
			}
		},

		_setLabelAttr: function(/*String*/label){
			// summary:
			//		Sets the category header text.
			// tags:
			//		private
			this.label = label;
			this.domNode.innerHTML = this._cv ? this._cv(label) : label;
		}
	});
});

},
'dojox/mobile/RoundRectList':function(){
define([
	"dojo/_base/array",
	"dojo/_base/declare",
	"dojo/_base/event",
	"dojo/_base/lang",
	"dojo/_base/window",
	"dojo/dom-construct",
	"dijit/_Contained",
	"dijit/_Container",
	"dijit/_WidgetBase"
], function(array, declare, event, lang, win, domConstruct, Contained, Container, WidgetBase){

	// module:
	//		dojox/mobile/RoundRectList

	return declare("dojox.mobile.RoundRectList", [WidgetBase, Container, Contained], {
		// summary:
		//		A rounded rectangle list.
		// description:
		//		RoundRectList is a rounded rectangle list, which can be used to
		//		display a group of items. Each item must be a dojox/mobile/ListItem.

		// transition: String
		//		The default animated transition effect for child items.
		transition: "slide",

		// iconBase: String
		//		The default icon path for child items.
		iconBase: "",

		// iconPos: String
		//		The default icon position for child items.
		iconPos: "",

		// select: String
		//		Selection mode of the list. The check mark is shown for the
		//		selected list item(s). The value can be "single", "multiple", or "".
		//		If "single", there can be only one selected item at a time.
		//		If "multiple", there can be multiple selected items at a time.
		//		If "", the check mark is not shown.
		select: "",

		// stateful: Boolean
		//		If true, the last selected item remains highlighted.
		stateful: false,

		// syncWithViews: Boolean
		//		If true, this widget listens to view transition events to be
		//		synchronized with view's visibility.
		syncWithViews: false,

		// editable: Boolean
		//		If true, the list can be reordered.
		editable: false,

		// tag: String
		//		A name of html tag to create as domNode.
		tag: "ul",

		/* internal properties */
		// editableMixinClass: String
		//		The name of the mixin class.
		editableMixinClass: "dojox/mobile/_EditableListMixin",
		
		// baseClass: String
		//		The name of the CSS class of this widget.
		baseClass: "mblRoundRectList",

		buildRendering: function(){
			this.domNode = this.srcNodeRef || domConstruct.create(this.tag);
			this.inherited(arguments);
		},

		postCreate: function(){
			if(this.editable){
				require([this.editableMixinClass], lang.hitch(this, function(module){
					declare.safeMixin(this, new module());
				}));
			}
			this.connect(this.domNode, "onselectstart", event.stop);

			if(this.syncWithViews){ // see also TabBar#postCreate
				var f = function(view, moveTo, dir, transition, context, method){
					var child = array.filter(this.getChildren(), function(w){
						return w.moveTo === "#" + view.id || w.moveTo === view.id; })[0];
					if(child){ child.set("selected", true); }
				};
				this.subscribe("/dojox/mobile/afterTransitionIn", f);
				this.subscribe("/dojox/mobile/startView", f);
			}
		},

		resize: function(){
			// summary:
			//		Calls resize() of each child widget.
			array.forEach(this.getChildren(), function(child){
				if(child.resize){ child.resize(); }
			});
		},

		onCheckStateChanged: function(/*Widget*//*===== listItem, =====*/ /*String*//*===== newState =====*/){
			// summary:
			//		Stub function to connect to from your application.
			// description:
			//		Called when the check state has been changed.
		},

		_setStatefulAttr: function(stateful){
			// tags:
			//		private
			this._set("stateful", stateful);
			this.selectOne = stateful;
			array.forEach(this.getChildren(), function(child){
				child.setArrow && child.setArrow();
			});
		},

		deselectItem: function(/*dojox/mobile/ListItem*/item){
			// summary:
			//		Deselects the given item.
			item.set("selected", false);
		},

		deselectAll: function(){
			// summary:
			//		Deselects all the items.
			array.forEach(this.getChildren(), function(child){
				child.set("selected", false);
			});
		},

		selectItem: function(/*ListItem*/item){
			// summary:
			//		Selects the given item.
			item.set("selected", true);
		}
	});
});

},
'dojox/mobile/TabBar':function(){
define([
	"dojo/_base/array",
	"dojo/_base/declare",
	"dojo/_base/window",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/dom-geometry",
	"dojo/dom-style",
	"dijit/_Contained",
	"dijit/_Container",
	"dijit/_WidgetBase",
	"./TabBarButton" // to load TabBarButton for you (no direct references)
], function(array, declare, win, domClass, domConstruct, domGeometry, domStyle, Contained, Container, WidgetBase, TabBarButton){

	// module:
	//		dojox/mobile/TabBar

	return declare("dojox.mobile.TabBar", [WidgetBase, Container, Contained],{
		// summary:
		//		A bar widget that has buttons to control visibility of views.
		// description:
		//		TabBar is a container widget that has typically multiple
		//		TabBarButtons which controls visibility of views. It can be used
		//		as a tab container.

		// iconBase: String
		//		The default icon path for child items.
		iconBase: "",

		// iconPos: String
		//		The default icon position for child items.
		iconPos: "",

		// barType: String
		//		"tabBar", "segmentedControl", "standardTab", "slimTab", "flatTab",
		//		or "tallTab"
		barType: "tabBar",

		// closable: Boolean
		//		If true, user can close (destroy) a child tab by clicking the X on the tab.
		//		This property is NOT effective for "tabBar" and "tallBar".
		closable: false,

		// center: Boolean
		//		If true, place the tabs in the center of the bar.
		//		This property is NOT effective for "tabBar".
		center: true,

		// syncWithViews: Boolean
		//		If true, this widget listens to view transition events to be
		//		synchronized with view's visibility.
		syncWithViews: false,

		// tag: String
		//		A name of html tag to create as domNode.
		tag: "ul",

		/* internal properties */
		// selectOne: [private] Boolean
		//		Specifies that only one item can be selected.
		selectOne: true,
		baseClass: "mblTabBar",
		_fixedButtonWidth: 76,
		_fixedButtonMargin: 17,
		_largeScreenWidth: 500,

		buildRendering: function(){
			this.domNode = this.srcNodeRef || domConstruct.create(this.tag);
			this.reset();
			this.inherited(arguments);
		},

		postCreate: function(){
			if(this.syncWithViews){ // see also RoundRect#postCreate
				var f = function(view, moveTo, dir, transition, context, method){
					var child = array.filter(this.getChildren(), function(w){
						return w.moveTo === "#" + view.id || w.moveTo === view.id; })[0];
					if(child){ child.set("selected", true); }
				};
				this.subscribe("/dojox/mobile/afterTransitionIn", f);
				this.subscribe("/dojox/mobile/startView", f);
			}
		},

		startup: function(){
			if(this._started){ return; }
			this.inherited(arguments);
			this.resize();
		},

		reset: function(){
			// summary:
			//		Resets the widget to its initial state.
			var prev = this._barType;
			if(typeof this.barType === "object"){
				this._barType = this.barType["*"];
				for(var c in this.barType){
					if(domClass.contains(win.doc.documentElement, c)){
						this._barType = this.barType[c];
						break;
					}
				}
			}else{
				this._barType = this.barType;
			}
			var cap = function(s){
				return s.charAt(0).toUpperCase() + s.substring(1);
			};
			if(prev){
				domClass.remove(this.domNode, this.baseClass + cap(prev));
			}
			domClass.add(this.domNode, this.baseClass + cap(this._barType));
		},

		resize: function(size){
			var i, w;
			if(size && size.w){
				domGeometry.setMarginBox(this.domNode, size);
				w = size.w;
			}else{
				// Calculation of the bar width varies according to its "position" value.
				// When the widget is used as a fixed bar, its position would be "absolute".
				w = domStyle.get(this.domNode, "position") === "absolute" ?
					domGeometry.getContentBox(this.domNode).w : domGeometry.getMarginBox(this.domNode).w;
			}
			var bw = this._fixedButtonWidth;
			var bm = this._fixedButtonMargin;
			var arr = array.map(this.getChildren(), function(w){ return w.domNode; });

			domClass.toggle(this.domNode, "mblTabBarNoIcons",
							!array.some(this.getChildren(), function(w){ return w.iconNode1; }));
			domClass.toggle(this.domNode, "mblTabBarNoText",
							!array.some(this.getChildren(), function(w){ return w.label; }));

			var margin = 0;
			if (this._barType == "tabBar"){
				this.containerNode.style.paddingLeft = "";
				margin = Math.floor((w - (bw + bm * 2) * arr.length) / 2);
				if(w < this._largeScreenWidth || margin < 0){
					// If # of buttons is 4, for example, assign "25%" to each button.
					// More precisely, 1%(left margin) + 98%(bar width) + 1%(right margin)
					for(i = 0; i < arr.length; i++){
						arr[i].style.width = Math.round(98/arr.length) + "%";
						arr[i].style.margin = "0";
					}
				}else{
					// Fixed width buttons. Mainly for larger screen such as iPad.
					for(i = 0; i < arr.length; i++){
						arr[i].style.width = bw + "px";
						arr[i].style.margin = "0 " + bm + "px";
					}
					if(arr.length > 0){
						arr[0].style.marginLeft = margin + bm + "px";
					}
					this.containerNode.style.padding = "0px";
				}
			}else{
				for(i = 0; i < arr.length; i++){
					arr[i].style.width = arr[i].style.margin = "";
				}
				var parent = this.getParent();
				if(this.center && (!parent || !domClass.contains(parent.domNode, "mblHeading"))){
					margin = w;
					for(i = 0; i < arr.length; i++){
						margin -= domGeometry.getMarginBox(arr[i]).w;
					}
					margin = Math.floor(margin/2);
				}
				this.containerNode.style.paddingLeft = margin ? margin + "px" : "";
			}
		},

		getSelectedTab: function(){
			// summary:
			//		Returns the first selected child.
			return array.filter(this.getChildren(), function(w){ return w.selected; })[0];
		},

		onCloseButtonClick: function(/*TabBarButton*/tab){
			// summary:
			//		Called whenever the close button [X] of a child tab is clicked.
			return true;
		}
	});
});

},
'dojox/mobile/TabBarButton':function(){
define([
	"dojo/_base/connect",
	"dojo/_base/declare",
	"dojo/_base/event",
	"dojo/_base/lang",
	"dojo/dom",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/dom-style",
	"./iconUtils",
	"./_ItemBase",
	"./Badge",
	"./sniff"
], function(connect, declare, event, lang, dom, domClass, domConstruct, domStyle, iconUtils, ItemBase, Badge, has){

	// module:
	//		dojox/mobile/TabBarButton

	return declare("dojox.mobile.TabBarButton", ItemBase,{
		// summary:
		//		A button widget that is placed in the TabBar widget.
		// description:
		//		TabBarButton is a button that is placed in the TabBar widget. It
		//		is a subclass of dojox/mobile/_ItemBase just like ListItem or
		//		IconItem. So, unlike Button, it has similar capability as
		//		ListItem or IconItem, such as icon support, transition, etc.

		// icon1: String
		//		A path for the unselected (typically dark) icon. If icon is not
		//		specified, the iconBase parameter of the parent widget is used.
		icon1: "",

		// icon2: String
		//		A path for the selected (typically highlight) icon. If icon is
		//		not specified, the iconBase parameter of the parent widget or
		//		icon1 is used.
		icon2: "",

		// iconPos1: String
		//		The position of an aggregated unselected (typically dark)
		//		icon. IconPos1 is a comma-separated list of values like
		//		top,left,width,height (ex. "0,0,29,29"). If iconPos1 is not
		//		specified, the iconPos parameter of the parent widget is used.
		iconPos1: "",

		// iconPos2: String
		//		The position of an aggregated selected (typically highlight)
		//		icon. IconPos2 is a comma-separated list of values like
		//		top,left,width,height (ex. "0,0,29,29"). If iconPos2 is not
		//		specified, the iconPos parameter of the parent widget or
		//		iconPos1 is used.
		iconPos2: "",

		// selected: Boolean
		//		If true, the button is in the selected state.
		selected: false,

		// transition: String
		//		A type of animated transition effect.
		transition: "none",

		// tag: String
		//		A name of html tag to create as domNode.
		tag: "li",

		// badge: String
		//		A string to show on a badge. (ex. "12")
		badge: "",

		/* internal properties */	
		baseClass: "mblTabBarButton",
		// closeIcon: [private] String
		//		CSS class for the close icon.
		closeIcon: "mblDomButtonWhiteCross",

		_selStartMethod: "touch",
		_selEndMethod: "touch",

		destroy: function(){
			if(this.badgeObj){
				delete this.badgeObj;
			}
			this.inherited(arguments);
		},

		inheritParams: function(){
			// summary:
			//		Overrides dojox/mobile/_ItemBase.inheritParams().
			if(this.icon && !this.icon1){ this.icon1 = this.icon; }
			var parent = this.getParent();
			if(parent){
				if(!this.transition){ this.transition = parent.transition; }
				if(this.icon1 && parent.iconBase &&
					parent.iconBase.charAt(parent.iconBase.length - 1) === '/'){
					this.icon1 = parent.iconBase + this.icon1;
				}
				if(!this.icon1){ this.icon1 = parent.iconBase; }
				if(!this.iconPos1){ this.iconPos1 = parent.iconPos; }
				if(this.icon2 && parent.iconBase &&
					parent.iconBase.charAt(parent.iconBase.length - 1) === '/'){
					this.icon2 = parent.iconBase + this.icon2;
				}
				if(!this.icon2){ this.icon2 = parent.iconBase || this.icon1; }
				if(!this.iconPos2){ this.iconPos2 = parent.iconPos || this.iconPos1; }

				if(parent.closable){
					if(!this.icon1){
						this.icon1 = this.closeIcon;
					}
					if(!this.icon2){
						this.icon2 = this.closeIcon;
					}
					domClass.add(this.domNode, "mblTabBarButtonClosable");
				}
			}
		},

		buildRendering: function(){
			this.domNode = this.srcNodeRef || domConstruct.create(this.tag);

			if(this.srcNodeRef){
				if(!this.label){
					this.label = lang.trim(this.srcNodeRef.innerHTML);
				}
				this.srcNodeRef.innerHTML = "";
			}

			this.labelNode = this.box = domConstruct.create("div", {className:"mblTabBarButtonLabel"}, this.domNode);

			this.inherited(arguments);
		},

		startup: function(){
			if(this._started){ return; }

			this._dragstartHandle = this.connect(this.domNode, "ondragstart", event.stop);
			this._keydownHandle = this.connect(this.domNode, "onkeydown", "_onClick"); // for desktop browsers
			var parent = this.getParent();
			if(parent && parent.closable){
				this._clickCloseHandler = this.connect(this.iconDivNode, "onclick", "_onCloseButtonClick");
				this._keydownCloseHandler = this.connect(this.iconDivNode, "onkeydown", "_onCloseButtonClick"); // for desktop browsers
				this.iconDivNode.tabIndex = "0";
			}

			this.inherited(arguments);
			if(!this._isOnLine){
				this._isOnLine = true;
				// retry applying the attribute for which the custom setter delays the actual 
				// work until _isOnLine is true. 
				this.set({
					icon: this._pendingIcon !== undefined ? this._pendingIcon : this.icon,
					icon1:this.icon1,
					icon2:this.icon2});
				// Not needed anymore (this code executes only once per life cycle):
				delete this._pendingIcon; 
			}
			dom.setSelectable(this.domNode, false);
		},

		onClose: function(e){
			// summary:
			//		Called when the parent is a dojox/mobile/TabBar whose closable property is true, and the user clicked the close button.
			connect.publish("/dojox/mobile/tabClose", [this]);
			return this.getParent().onCloseButtonClick(this);
		},

		_onCloseButtonClick: function(e){
			if(e && e.type === "keydown" && e.keyCode !== 13){ return; }
			if(this.onCloseButtonClick(e) === false){ return; } // user's click action
			if(this.onClose()){
				this.destroy();
			}
		},

		onCloseButtonClick: function(/*Event*/ /*===== e =====*/){
			// summary:
			//		User defined function to handle clicks
			//		when the parent is a dojox/mobile/TabBar whose closable property is true.
			// tags:
			//		callback
		},

		_onClick: function(e){
			// summary:
			//		Internal handler for click events.
			// tags:
			//		private
			if(e && e.type === "keydown" && e.keyCode !== 13){ return; }
			if(this.onClick(e) === false){ return; } // user's click action
			this.defaultClickAction(e);
		},

		onClick: function(/*Event*/ /*===== e =====*/){
			// summary:
			//		User defined function to handle clicks
			// tags:
			//		callback
		},

		_setIcon: function(icon, n){
			if(!this.getParent()){ return; } // icon may be invalid because inheritParams is not called yet
			this._set("icon" + n, icon);
			if(!this.iconDivNode){
				this.iconDivNode = domConstruct.create("div", {className:"mblTabBarButtonIconArea"}, this.domNode, "first");
				// mblTabBarButtonDiv -> mblTabBarButtonIconArea
			}
			if(!this["iconParentNode" + n]){
				this["iconParentNode" + n] = domConstruct.create("div", {className:"mblTabBarButtonIconParent mblTabBarButtonIconParent" + n}, this.iconDivNode);
				// mblTabBarButtonIcon -> mblTabBarButtonIconParent
			}
			this["iconNode" + n] = iconUtils.setIcon(icon, this["iconPos" + n],
				this["iconNode" + n], this.alt, this["iconParentNode" + n]);
			this["icon" + n] = icon;
			domClass.toggle(this.domNode, "mblTabBarButtonHasIcon", icon && icon !== "none");
		},

		_setIcon1Attr: function(icon){
			this._setIcon(icon, 1);
		},

		_setIcon2Attr: function(icon){
			this._setIcon(icon, 2);
		},

		_getBadgeAttr: function(){
			return this.badgeObj && this.badgeObj.domNode.parentNode &&
				this.badgeObj.domNode.parentNode.nodeType == 1 ? this.badgeObj.getValue() : null;
		},

		_setBadgeAttr: function(/*String*/value){
			if(!this.badgeObj){
				this.badgeObj = new Badge({fontSize:11});
				domStyle.set(this.badgeObj.domNode, {
					position: "absolute",
					top: "0px",
					right: "0px"
				});
			}
			this.badgeObj.setValue(value);
			if(value){
				this.domNode.appendChild(this.badgeObj.domNode);
			}else{
				if(this.domNode === this.badgeObj.domNode.parentNode){
					this.domNode.removeChild(this.badgeObj.domNode);
				}
			}
		},

		_setSelectedAttr: function(/*Boolean*/selected){
			// summary:
			//		Makes this widget in the selected or unselected state.
			this.inherited(arguments);
			domClass.toggle(this.domNode, "mblTabBarButtonSelected", selected);
		}
	});
});

},
'dojox/mobile/Badge':function(){
define([
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/dom-class",
	"dojo/dom-construct",
	"./iconUtils"
], function(declare, lang, domClass, domConstruct, iconUtils){
	// module:
	//		dojox/mobile/Badge

	return declare("dojox.mobile.Badge", null, {
		// summary:
		//		A utility to create/update a badge node.
		// description:
		//		Badge is not a widget, but just a convenience class. A badge
		//		consists of a simple DOM button.

		// value: String
		//		A text to show in a badge.
		value: "0",

		// className: String
		//		A CSS class name of a DOM button.
		className: "mblDomButtonRedBadge",

		// fontSize: Number
		//		Font size in pixel. The other style attributes are determined by the DOM
		//		button itself.
		fontSize: 16, // [px]

		constructor: function(/*Object?*/params, /*DomNode?*/node){
			// summary:
			//		Creates a new instance of the class.
			// params:
			//		Contains properties to be set.
			// node:
			//		The DOM node. If none is specified, it is automatically created. 
			if (params){
				lang.mixin(this, params);
			}
			this.domNode = node ? node : domConstruct.create("div");
			domClass.add(this.domNode, "mblBadge");
			if(this.domNode.className.indexOf("mblDomButton") === -1){
				domClass.add(this.domNode, this.className);
			}
			if(this.fontSize !== 16){
				this.domNode.style.fontSize = this.fontSize + "px";
			}
			iconUtils.createDomButton(this.domNode);
			this.setValue(this.value);
		},

		getValue: function(){
			// summary:
			//		Returns the text shown in the badge.
			return this.domNode.firstChild.innerHTML || "";
		},

		setValue: function(/*String*/value){
			// summary:
			//		Set a label text to the badge.
			this.domNode.firstChild.innerHTML = value;
		}
	});
});

}}});
(function(){
	// must use this.require to make this work in node.js
	var require = this.require;
	// consume the cached dojo layer
	require({cache:{}});
	!require.async && require(["dojo"]);
	require.boot && require.apply(null, require.boot);
})();
