define([
	'dojo/node!express',
	'dojo/node!jade',
	'dojo/node!stylus',
	'dojo/node!nib',
	'dojo/node!colors'
], function (express, jade, stylus, nib) {

	/*jshint node:true */

	function compileStylus(str, path) {
		return stylus(str).set('filename', path).use(nib());
	}

	var base = '/lib',
		app = express(),
		port = process.env.PORT || 8019,
		env = process.env.NODE_ENV || 'development';

	app.configure(function () {
		app.locals.pretty = true;
		app.set('view engine', 'jade');
		app.set('views', 'views');
		app.use(express.logger(env && env === 'production' ? null : 'dev'));
		app.use(express.compress());
		app.use(express.cookieParser());
		app.use(express.cookieSession({ secret: '2A7zqUpjyob3kmqXy4EP99mJsxOAuqoWN2CbNXl8' }));
		app.use(express.bodyParser());
		app.use(app.router);

		app.use(stylus.middleware({
			src: '.',
			compile: compileStylus,
			compress: true
		}));

		app.use('/_static', express['static']('./_static'));
		app.use('/src', express['static']('./src'));
		app.use('/lib', express['static']('./lib'));

		app.use('/500', function (request, response, next) {
			next(new Error('All your base are belong to us'));
		});

		app.use(function (request, response) {
			response.status(404);
			response.render('404', { url: request.url });
		});

		app.use(function (error, request, response) {
			response.status(error.status || 500);
			response.render('500', {
				error: error
			});
		});
	});

	app.all('/', function (request, response) {
		response.render('index', {
			base: base,
			title: 'Parking'
		});
	});

	app.listen(port);
	console.log('HTTP Server started on port: '.grey + port.toString().cyan);
});