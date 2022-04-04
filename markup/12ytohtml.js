const { escapeXml } = require("./escapes");
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

var autocloseTags = {
	"br": true,
	"img": true,
	"hr": true,
}

var toHtml = node => {
	if(typeof(node) === "string") {
		return escapeXml(node)
	}
	var tag = "";
	if(node.type !== "") {
		var tag = "<" + node.type;
		for(var i in node.attr) {
			tag += " " + escapeXml(i) + '="' + escapeXml(node.attr[i]) + '"'
		}
		if(autocloseTags[node.type]) {
			tag += " />";
			return tag;
		}
		
		tag += ">";
	}
	
	for(var i of (node.children || [])) {
		tag += toHtml(i);
	}
	
	if(node.type !== "") {
		tag += "</" + node.type + ">";
	}
	
	return tag;
}

const htmloptions = {
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
			type: "span",
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
			type: "pre",
			children: [{
				type: "code",
				attr: {
					...(lang ? {"class": "language-" + lang} : {})
				},
				children: [contents]
			}]
		})
	},
	icode(args, contents) {
		return createElement({
			type: "code",
			children: [contents]
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
			type: "h" + (level + 1)
		})
	},
	quote(args) {
		var name = args[""]
		return createElement({
			type: "blockquote",
			children: name ? [
				{
					type: "cite",
					children: [name]
				},
				{
					type: "br"
				}
			] : []
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
		link.node.children = [args[""]];
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
			},
		})
		
		if(opt.c) {
			cell.node.attr["data-mx-bg-color"] = opt.c;
		}
		
		return cell;
	},
	image(args, alt) {
		var url = args[""]
		url = this.filterURL(url, "image")
		if(url == null)
			return this.simpleLink(args)
		
		// <img>s in matrix require that the src url be mxc://
		// images from 12y are not mxc://
		// so just insert them as links
		return createElement({
			type: "a",
			attr: {
				href: url,
			},
			children: [
				alt != null ? alt : url,
			]
		})
		// return createElement({
		// 	type: "img",
		// 	attr: {
		// 		src: url,
		// 		...(alt != null ? {alt} : {}),
		// 	}
		// })
	},
	error(e, stack) {
		return createElement({
			type: "div",
			children: [
				"Markup parsing error: ",
				{
					type: "code",
					children: [e]
				},
				"\nPlease report this!",
				...(stack ? [{
					type: "pre",
					children: [stack]
				}] : [])
			]
		})
	},
	align(args) {
		return createElement({
			type: "div"
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
			type: "a",
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
			children: [
				{
					type: "span"
				},
				{
					type: "rp",
					children: ["("]
				},
				{
					type: "rt",
					children: [args[""]]
				},
				{
					type: "rp",
					children: [")"]
				}
			]
		}, 0)
	},
	spoiler(args) {
		return createElement({
			type: "span",
			attr: {
				"data-mx-spoiler": args[""] === true ? "" : args[""]
			}
		})
	},
	bg(opt) {
		var node = {
			type: "span"
		}
		if(opt[""]) {
			node.attr["data-mx-bg-color"] = opt[""];
		}
		return createElement(node);
	}
}

module.exports = text => {
	Parse.options = htmloptions;
	const ast = Parse.parseLang(text, "12y", false);
	return toHtml(ast);
}
