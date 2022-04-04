const { htmlto12y, escape12y } = require("./htmlto12y");

/**
 * Makes a contentapi formatted message from a matrix event
 * @param {object} evt Matrix event.content
 * @param {(url: string) => string} urlOrMxc Function to transform URLs
 */
module.exports.evtToMarkup = function(evt, urlOrMxc) {
	let text;
	let markup = "plaintext";
	if(evt.body) { // fallback
		text = evt.body;
	}
	if(evt.format === "org.matrix.custom.html") {
		markup = "12y";
		text = htmlto12y(evt.formatted_body, urlOrMxc);
	}
	
	if(evt.msgtype === "m.image") {
		markup = "12y";
		text = "!" + urlOrMxc(evt.url) + (evt.body === "image.png" ? "" : "[" + escape12y(evt.body) + "]");
	}
	if(evt.msgtype === "m.emote") {
		if(markup !== "12y") {
			markup = "12y";
			text = "{/" + escape12y(text) + "}";
		} else {
			text = "{/" + text + "}";
		}
	}
	
	return {
		text, markup
	}
}
