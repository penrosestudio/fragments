/*\
title: $:/plugins/wshallum/couchadaptor/couchadaptor.js
type: application/javascript
module-type: syncadaptor

A sync adaptor module for synchronising with CouchDB

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

function CouchAdaptor(options) {
	this.wiki = options.wiki;
	this.logger = new $tw.utils.Logger("CouchAdaptor");
	//this.host = 'http://penrose.iriscouch.com'; // TODO make configurable
	this.host = 'https://penrose.cloudant.com'; // TODO make configurable
	this.urlPrefix = '/fragments-test'; // TODO make configurable
	this.designDocName = '/_design/fragments-test'; // TODO make configurable
	this.sessionUrl = '/_session';
}

function httpRequest(options) { // custom version of $tw.utils.httpRequest to allow for withCredentials to be set
	var type = options.type || "GET",
		headers = options.headers || {accept: "application/json"},
		request = new XMLHttpRequest(),
		data = "",
		f,results;
	// Massage the data hashmap into a string
	if(options.data) {
		if(typeof options.data === "string") { // Already a string
			data = options.data;
		} else { // A hashmap of strings
			results = [];
			$tw.utils.each(options.data,function(dataItem,dataItemTitle) {
				results.push(dataItemTitle + "=" + encodeURIComponent(dataItem));
			});
			data = results.join("&");
		}
	}
	// Add withCredentials to support CORS requests
	request.withCredentials = true;
	// Set up the state change handler
	request.onreadystatechange = function() {
		if(this.readyState === 4) {
			if(this.status === 200 || this.status === 201 || this.status === 204) {
				// Success!
				options.callback(null,this.responseText,this);
				return;
			}
		// Something went wrong
		options.callback("XMLHttpRequest error code: " + this.status);
		}
	};
	// Make the request
	request.open(type,options.url,true);
	if(headers) {
		$tw.utils.each(headers,function(header,headerTitle,object) {
			request.setRequestHeader(headerTitle,header);
		});
	}
	if(data && !$tw.utils.hop(headers,"Content-type")) {
		request.setRequestHeader("Content-type","application/x-www-form-urlencoded; charset=UTF-8");
	}
	request.send(data);
	return request;
}

/*
getTiddlerInfo(tiddler)
getSkinnyTiddlers(callback(err,data)) data is array of {title: ..., revision: ...}
saveTiddler(tiddler, callback(err, adaptorInfo, revision), options) options has options.tiddlerInfo
loadTiddler(tiddler, callback(err, tiddlerFields))
deleteTiddler(title, callback(err), options) options has options.tiddlerInfo
*/

CouchAdaptor.prototype.getTiddlerInfo = function(tiddler) {
	return {_rev: tiddler.fields.revision};
};


CouchAdaptor.prototype.getSkinnyTiddlers = function(callback) {
	var self = this;
	httpRequest({
		url: this.host + this.urlPrefix + this.designDocName + "/_view/skinny-tiddlers",
		callback: function(err, data) {
			// Check for errors
			if(err) {
				return callback(err);
			}
			// Process the tiddlers to make sure the revision is a string
			var tiddlers = JSON.parse(data).rows;
			for(var i=0; i < tiddlers.length; i++) {
				tiddlers[i] = self.convertFromSkinnyTiddler(tiddlers[i]);
			}
			// Invoke the callback with the skinny tiddlers
			callback(null, tiddlers);
		}
	});
};

CouchAdaptor.prototype.saveTiddler = function(tiddler, callback, options) {
	var self = this;
	var convertedTiddler = this.convertToCouch(tiddler)
	var tiddlerInfo = options.tiddlerInfo;
	delete convertedTiddler._rev;
	if (tiddlerInfo.adaptorInfo && tiddlerInfo.adaptorInfo._rev) {
		convertedTiddler._rev = tiddlerInfo.adaptorInfo._rev;
	}
	convertedTiddler = JSON.stringify(convertedTiddler, null, false);
	httpRequest({
		url: this.host + this.urlPrefix +  "/" + encodeURIComponent(self.mangleTitle(tiddler.fields.title)),
		type: "PUT",
		headers: {
			"Content-type": "application/json"
		},
		data: convertedTiddler,
		callback: function(err,data,request) {
			if(err) {
				return callback(err);
			}
			var returnedData = JSON.parse(data);
			var newRevision = returnedData.rev;
			// Invoke the callback
			callback(null, { _rev: newRevision }, newRevision);
		}
	});
};

CouchAdaptor.prototype.loadTiddler = function(title, callback) {
	var self = this;
	httpRequest({
		url: this.host + this.urlPrefix + "/" + encodeURIComponent(self.mangleTitle(title)),
		callback: function(err, data, request) {
			if(err) {
				return callback(err);
			}
			// Invoke the callback
			callback(null, self.convertFromCouch(JSON.parse(data)));
		}
	});
};

/*
CouchDB does not like document IDs starting with '_'.
Convert leading '_' to '%5f' and leading '%' to '%25'
Only used to compute _id / URL for a tiddler. Does not affect 'title' field.
*/
CouchAdaptor.prototype.mangleTitle = function(title) {
	if (title.length == 0) {
		return title;
	}
	var firstChar = title.charAt(0);
	var restOfIt = title.substring(1);
	if (firstChar === '_') {
		return '%5f' + restOfIt;
	}
	else if (firstChar === '%') {
		return '%25' + restOfIt;
	}
	else {
		return title;
	}
}

/*
Reverse what mangleTitle does. Used to obtain title from _id (in convertFromSkinnyTiddler).
*/
CouchAdaptor.prototype.demangleTitle = function(title) {
	if (title.length < 3) {
		return title;
	}
	var firstThree = title.substring(0, 3);
	var restOfIt = title.substring(3);
	if (firstThree === '%5f') {
		return '_' + restOfIt;
	}
	else if (firstThree === '%25') {
		return '%' + restOfIt;
	}
	else {
		return title;
	}
}

CouchAdaptor.prototype.deleteTiddler = function(title, callback, options) {
	var self = this;
	if (!options.tiddlerInfo || !options.tiddlerInfo.adaptorInfo || typeof options.tiddlerInfo.adaptorInfo._rev == "undefined") {
		/* not on server, just return OK */
		callback(null);
	}
	// Issue HTTP request to delete the tiddler
	httpRequest({
		url: this.host + this.urlPrefix + "/" + encodeURIComponent(self.mangleTitle(title)),
		type: "DELETE",
		callback: function(err, data, request) {
			if(err) {
				return callback(err);
			}
			// Invoke the callback
			callback(null);
		},
		headers: { "If-Match": options.tiddlerInfo.adaptorInfo._rev }
	});
};

CouchAdaptor.prototype.convertFromSkinnyTiddler = function(row) {
	return {title: this.demangleTitle(row.key), revision: row.value};
}

/* for this version just copy all fields across, no special handling */
CouchAdaptor.prototype.convertToCouch = function(tiddler) {
	var result = { fields: {} };
	if (tiddler) {
		$tw.utils.each(tiddler.fields,function(element,title,object) {
			if (title === "revision") {
				/* do not store revision as a field */
			}
			else {
				result.fields[title] = tiddler.fields[title]
			}
		});
	}
	// Default the content type
	result.fields.type = result.fields.type || "text/vnd.tiddlywiki";
	return result;
}

/* for this version just copy all fields across except _rev and _id */
CouchAdaptor.prototype.convertFromCouch = function(tiddlerFields) {
	var self = this, result = {};
	// Transfer the fields, pulling down the `fields` hashmap
	$tw.utils.each(tiddlerFields, function(element, title, object) {
		if(title === "fields") {
			$tw.utils.each(element,function(element, subTitle, object) {
				result[subTitle] = element;
			});
		} else if (title === "_id" || title === "_rev") {
			/* skip these */
		} else {
			result[title] = tiddlerFields[title];
		}
	});
	return result;
}

CouchAdaptor.prototype.getStatus = function(callback) {
	httpRequest({
		url: this.host + this.sessionUrl,
		callback: function(err, data) {
			if (err) {
				return callback(err);
			}
			var json = null;
			var isLoggedIn = false;
			var username = null;
			try {
				json = JSON.parse(data);
			} catch (e) {
			}
			if (json && json.userCtx) {
				username = json.userCtx.name;
				isLoggedIn = (username !== null);
				if (!isLoggedIn && json.userCtx.roles.length == 1 && json.userCtx.roles[0] === '_admin') {
					/* admin party mode */
					isLoggedIn = true;
				}
			}
			callback(null, isLoggedIn, username);
		}
	});
}

CouchAdaptor.prototype.login = function(username, password, callback) {
	var options = {
		url: this.sessionUrl,
		type: "POST",
		data: {
			name: username,
			password: password
		},
		callback: function(err, data) {
			callback(err);
		}
	};
	httpRequest(options);
}

CouchAdaptor.prototype.logout = function(callback) {
	var options = {
		url: this.sessionUrl,
		type: "DELETE",
		callback: function(err) {
			callback(err);
		}
	};
	httpRequest(options);
}


if($tw.browser && document.location.protocol.substr(0,4) === "http" ) {
	exports.adaptorClass = CouchAdaptor;
}

})();
