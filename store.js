const fs = require("fs");
const path = require("path");

module.exports.store = fname => {
	const basename = fname;
	fname = path.join(__dirname, fname);
	let store = {};
	try {
		store = JSON.parse(fs.readFileSync(fname).toString());
	} catch {}
	
	return {
		store,
		save: () => {
			return fs.promises.writeFile(fname, JSON.stringify(store));
		}
	}
}
