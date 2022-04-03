const fs = require("fs");
const path = require("path");

module.exports.store = fname => {
	const basename = fname;
	fname = path.join(__dirname, fname);
	let store = {};
	try {
		store = JSON.parse(fs.readFileSync(fname).toString());
	} catch {}
	
	return new Proxy(store, {
		set(target, prop, val) {
			target[prop] = val;
			fs.writeFile(fname, JSON.stringify(target), err => {
				if(err) {
					console.error("Error writing to store " + basename, err);
				}
			});
		}
	})
}
