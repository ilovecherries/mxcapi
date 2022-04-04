const { escapeMd } = require("./escapes");
const Parse = require("./Parse");

function createElement(node, branch) {
	return {
		node,
		branch
	}
}

function getElement(obj) {
	if(("branch" in obj) && typeof(obj.branch) === "number") {
		return (obj.node.children || [])[obj.branch]
	}
	return obj.node;
}

var alert = console.log;

var toMd = node => {
	if(typeof(node) === "string") {
		return escapeMd(node);
	}
	
	const children = () => {
		let out = "";
		for(var i of (node.children || [])) {
			out += toMd(i);
		}
		return out;
	}
	
	switch(node.type) {
		case "":
			return children();
		case "a": {
			const text = children();
			const href = node.attr.href.startsWith("sbs:") ?
				"https://smilebasicsource.com/?p=" + node.attr.href.substr(4).replace(/\//g, "-")
				: node.attr.href;
			return href + (text && text !== node.attr.href ? " [" + text + "] " : "");
		}
		case "img":
			return node.attr.src + (node.attr.alt ? " [" + node.attr.alt + "]" : "") + "\n";
		case "br":
			return "\n";
		case "hr":
			return "\n---\n";
		case "codeblock":
			return "```" + (node.attr.lang || "") + "\n" + node.attr.contents + "```";
		case "code":
			return "`" + node.attr.contents + "`";
		case "b":
			return "**" + children() + "**";
		case "i":
			return "*" + children() + "*";
		case "u":
			return "__" + children() + "__";
		case "s":
			return "~~" + children() + "~~";
		case "h":
			return "#".repeat(node.attr.level) + " " + children() + "\n";
		case "spoiler":
			return (node.attr.spoiler ? "(spoiler: " + escapeMd(node.attr.spoiler) + ") " : "") +
				"||" + children() + "||";
		case "tr":
			return children() + "\n";
		case "th":
			return "|**" + children() + "**";
		case "td":
			return "|" + children();
		case "ul":
		case "ol":
			if(node.parent.type === "ol" || node.parent.type === "ul") {
				return "  " + children().split("\n").join("\n  ");
			}
			return children();
		case "li": {
			if(node.parent.type === "ol") {
				const pos = node.parent.children.indexOf(node);
				return (pos + 1) + ". " +
					children()
						.split("\n")
						.join("\n" + " ".repeat((pos + 1).toString().length + 2)) +
					"\n";
			}
			return "- " + children().split("\n").join("\n  ") + "\n";
		}
		case "blockquote":
			return (node.attr.name ? "(" + node.attr.name + ")\n" : "") + "> " + children().split("\n").join("\n> ") + "\n";
		// no markdown equivalents
		case "sub":
			return "{#sub " + children() + "}";
		case "sup":
			return "{#sup " + children() + "}";
		case "ruby":
			return "{#ruby=" + escapeMd(node.attr.ruby) + " " + children() + "}";
		case "bg":
			return "{#bg=" + escapeMd(node.attr.color) + " " + children() + "}";
		case "align":
			return "{#align=" + escapeMd(node.attr.align) + " " + children() + "}";
		default:
			return children();
	}
}

const mdoptions = {
	createLink(url) {
		if(/^ *javascript:/i.test(url)) {
			url = ""
		}
		
		return createElement({
			type: "a",
			attr: {
				"_target": "blank",
				href: url
			}
		})
	},
	urlProtocol(url) {
		var match = url.match(/^([-\w]+:)([^]*)$/)
		if (match)
			return [match[1].toLowerCase(), match[2]]
		return [null, url]
	},
	getYoutubeID(url) {
		var match = url.match(/(?:https?:\/\/)?(?:www\.)?youtu\.?be(?:\.com)?\/?.*(?:watch|embed)?(?:.*v=|v\/|\/)([\w\-_]+)\&?/)
		if (match)
			return match[1]
		return null
	},
	append(parentEl, child) {
		var parent = getElement(parentEl);
		if(typeof(child.node) === "object") {
			child.node.parent = parent;
		}
		parent.children = (parent.children || []).concat([child.node])
	},
	kill(node, before) {
		var parent = node.parent;
		if(!parent) {
			return;
		}
		var children = parent.children || [];
		var childIndex = children.indexOf(node);
		children.splice(childIndex, 1, ...node.children);
		for(var i = 0; i < children.length; i++) {
			if(typeof(children[i]) === "object" && chidlren[i] !== null && children[i].parent) {
				children[i].parent = parent;
			}
		}
		parent.children = children;
	},
	filterURL(url, type) {
		return url
	},
	text(text) {
		return {
			node: text
		};
	},
	lineBreak() {
		return createElement({
			type: "br"
		})
	},
	line() {
		return createElement({
			type: "hr"
		})
	},
	invalid(text, reason) {
		return createElement({
			type: "invalid",
			attr: {
				class: "invalid",
				title: reason,
			},
			children: [text]
		})
	},
	code(args, contents) {
		var lang = args[""]
		return createElement({
			type: "codeblock",
			attr: {
				lang,
				contents
			}
		})
	},
	icode(args, contents) {
		return createElement({
			type: "code",
			attr: {
				contents
			}
		})
	},
	audio(args, contents) {
		return this.simpleLink(args)
	},
	video(args, contents) {
		return this.simpleLink(args)
	},
	youtube(args, contents, preview) {
		return this.simpleLink(args)
	},
	root() {
		return createElement({
			type: ""
		})
	},
	bold() {
		return createElement({
			type: "b"
		})
	},
	italic() {
		return createElement({
			type: "i"
		})
	},
	underline() {
		return createElement({
			type: "u"
		})
	},
	strikethrough() {
		return createElement({
			type: "s"
		})
	},
	heading(level) {
		return createElement({
			type: "h",
			attr: {
				level
			}
		})
	},
	quote(args) {
		var name = args[""]
		return createElement({
			type: "blockquote",
			attr: {
				name
			}
		})
	},
	list(args) {
		if(args[""] != undefined) {
			return createElement({
				type: "ol"
			})
		} else {
			return createElement({
				type: "ul"
			})
		}
	},
	item(index) {
		return createElement({
			type: "li"
		})
	},
	simpleLink(args) {
		var link = this.createLink(args[""]);
		return link;
	},
	customLink(args) {
		var link = this.createLink(args[""]);
		return link;
	},
	table(opts) {
		return createElement({
			type: "table"
		})
	},
	row() {
		return createElement({
			type: "tr"
		})
	},
	cell(opt) {
		var cell = createElement({
			type: opt.h ? "th" : "td",
			attr: {
				...(opt.rs ? {rowspan: opt.rs} : {}),
				...(opt.cs ? {colspan: opt.cs} : {}),
				class: "cell"
			}
		})
		
		return cell;
	},
	image(args, alt) {
		var url = args[""]
		url = this.filterURL(url, "image")
		if(url == null)
			return this.simpleLink(args)
		
		return createElement({
			type: "img",
			attr: {
				src: url,
				...(alt != null ? {alt} : {}),
			}
		})
	},
	error(e, stack) {
		return createElement({
			type: "error",
			attr: {
				e,
				stack
			}
		})
	},
	align(args) {
		return createElement({
			type: "align",
			attr: {
				align: args[""]
			}
		})
	},
	superscript() {
		return createElement({
			type: "sup"
		})
	},
	subscript() {
		return createElement({
			type: "sub"
		})
	},
	anchor(args) {
		var name = args[""]
		return createElement({
			type: "anchor",
			attr: {
				name: "_anchor_" + name
			}
		})
	},
	ruby(args) {
		var first = {
			type: "span"
		}
		
		return createElement({
			type: "ruby",
			attr: {
				ruby: args[""]
			}
		})
	},
	spoiler(args) {
		return createElement({
			type: "spoiler",
			attr: {
				spoiler: args[""] === true ? "" : args[""]
			}
		})
	},
	bg(opt) {
		var node = {
			type: "bg",
			attr: {
				color: opt[""]
			}
		}
		return createElement(node);
	}
}

module.exports.toMd = text => {
	Parse.options = mdoptions;
	const ast = Parse.parseLang(text, "12y", false);
	return toMd(ast);
}
