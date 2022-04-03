// helper functions for matrix

const { store } = require("./store");

const files = store("files.json");

module.exports.ensureUploaded = async function(id, intent) {
	if(id in files) {
		return files[id];
	}
	if(id === "0") {
		return;
	}
	
	const url = capi.url + "/api/file/raw/" + id;
	
	console.log("fetching file", url);
	const { default: fetch } = await import("node-fetch");
	const res = await fetch(url);
	const blob = await res.blob();
	const buffer = Buffer.from(await blob.arrayBuffer());
	
	console.log("uploading to matrix: content type", blob.type);
	const mxc = await intent.uploadContent(buffer, blob.type);
	
	console.log("got mxc url", mxc);
	files[id] = mxc;
	return mxc;
}
