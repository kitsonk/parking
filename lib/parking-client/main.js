define("parking-client/main", [
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