const parser = require("node-html-parser");
const { escape12y } = require("./escapes");

/**
 * @param {parser.HTMLElement} el
 * @returns {string}
 */
const to12y = (el, transformUrl = a => a) => {
	const children = () => el.childNodes.map(n => to12y(n, transformUrl)).join("")
	
	switch(el.nodeType) {
		case parser.NodeType.TEXT_NODE:
			return escape12y(el.text.replace(/\n/g, ""));
		case parser.NodeType.ELEMENT_NODE:
			switch(el.tagName) {
				case "EM":
				case "I":
					return "{/" + children() + "}";
				case "STRONG":
				case "B":
					return "{*" + children() + "}";
				case "S":
				case "DEL":
					return "{~" + children() + "}";
				case "CODE":
					return "`" + children().replace(/`/g, "``") + "`";
				case "A": {
					const href = el.getAttribute("href")
					const inside = children();
					let hasAlt = true;
					if(
						el.childNodes.length === 1 &&
						el.childNodes[0].nodeType === parser.NodeType.TEXT_NODE &&
						el.childNodes[0].text === href
					) {
						hasAlt = false;
					}
					return transformUrl(href) + (hasAlt ? "[" + inside + "]" : "")
				}
				case "IMG": {
					const src = el.getAttribute("src")
					const alt = el.getAttribute("alt")
					return "!" + transformUrl(src) + (alt ? "[" + alt + "]" : "") + "\n";
				}
				case "PRE": {
					if(
						el.childNodes.length === 1 &&
						el.childNodes[0].nodeType === parser.NodeType.ELEMENT_NODE &&
						el.childNodes[0].tagName === "CODE"
					) {
						const code = el.childNodes[0];
						const className = code.getAttribute("class");
						let lang = "";
						if(className.startsWith("language-")) {
							lang = className.substr("language-".length);
						}
						
						return "```" + lang + "\n" + code.textContent + "```\n";
					} else {
						return children();
					}
				}
				case "BLOCKQUOTE":
					return ">{" + children() + "}\n";
				case "SPAN": {
					if(el.hasAttribute("data-mx-spoiler")) {
						return "{#spoiler=" + (el.getAttribute("data-mx-spoiler") || "") + " " + children() + "}";
					} else {
						return children();
					}
				}
				case "H1":
					return "* " + children() + "\n";
				case "H2":
					return "** " + children() + "\n";
				case "H3":
					return "*** " + children() + "\n";
				case "H4":
					return "**** " + children() + "\n";
				case "H5":
					return "***** " + children() + "\n";
				case "H6":
					return "****** " + children() + "\n";
				case "LI": {
					let curr = el;
					let level = 0;
					while(
						curr.parentNode &&
						curr.parentNode.nodeType === parser.NodeType.ELEMENT_NODE &&
						(curr.parentNode.tagName === "UL" || curr.parentNode.tagName === "OL")
					) {
						curr = curr.parentNode;
						level++;
					}
					return " ".repeat(level - 1) + "-{" + children() + "}\n";
				}
				case "BR":
					return "\n";
				default:
					return children();
			}
	}
	
	
	let out = "";
	for(const token of tokens) {
		switch(token.type) {
			case "text":
				out += escape12y(token.content, transformUrl, transformUrl);
				break;
			case "br":
				out += "\n";
				break;
			case "em":
				out += "{/" + to12y(token.content, transformUrl) + "}";
				break;
			case "strong":
				out += "{*" + to12y(token.content, transformUrl) + "}";
				break;
			case "s":
				out += "{~" + to12y(token.content, transformUrl) + "}";
				break;
			case "spoiler":
				out += "{#spoiler= " + to12y(token.content, transformUrl) + "}";
				break;
			case "inlineCode":
				out += "`" + token.content.replace(/`/g, "``") + "`";
				break;
			case "codeBlock":
				out += "```" + token.lang + "\n" + token.content + "```";
				break;
			case "link": {
				const altIsSame = !token.content.length || (token.content && token.content.length === 1 && token.content[0].type === "text" && (token.content[0].content === "" || token.content[0].content === token.target));
				out += token.target + (altIsSame ? "" : "[" + to12y(token.content, transformUrl) + "]");
				break;
			}
			case "blockQuote":
				out += ">{" + to12y(token.content, transformUrl) + "}\n";
				break;
		}
	}
	return out;
}

const htmlto12y = module.exports.htmlto12y = (text, url) => {
	const parsed = parser.parse(text, {
		lowerCaseTagName: true,
		blockTextElements: {}
	})
	return to12y(parsed, url);
}


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
