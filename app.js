//Ver 0.0.1(alpha)
const express = require('express');
require('express-async-errors');
const app = express();
const fs = require('fs');
const axios = require('axios');
const querystring = require('querystring');
const crypto = require('crypto');
const toml = require('toml');
const path = require('path')
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
const CONFIG = toml.parse(fs.readFileSync(path.join(__dirname, 'config.toml'), 'utf-8'));

if (!String.prototype.strip) {
    String.prototype.strip = function (string) {
        var escaped = string.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
        return this.replace(RegExp("^[" + escaped + "]+|[" + escaped + "]+$", "gm"), '');
    };
}

function render_size(value) {
    //格式化文件大小
    if (value === null) {
        return "0 Bytes";
    }
    let unitArr = new Array("Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB");
    let index = 0, srcsize = value;
    index = Math.floor(Math.log(srcsize) / Math.log(1024));
    let size = srcsize / Math.pow(1024, index);
    //保留的小数位数
    size = size.toFixed(2);
    return size + " " + unitArr[index];
}

class onedrive_client {
    constructor() {
        const token = JSON.parse(fs.readFileSync(path.join(__dirname, 'token.json'), 'utf-8'))
        this._client_id = token.client_id;
        this._client_secret = token.client_secret;
        this._redirect_uri_register = token.redirect_uri;
        this._api_url = "https://graph.microsoft.com/v1.0/";
        this._token = {
            refresh_token: token.refresh_token,
            time: 0,
            drive: "",
            access_token: "",
            scope: token.scope
        }
        this._authed_headers = {
            "Authorization": "bearer " + this._token.access_token,
            "Content-Type": "application/json"
        }
    }
    async refresh_token() {
        if (Date.now() - this._token.time > 3500 * 1000) {
            const post_data = querystring.stringify({
                "client_id": this._client_id,
                "client_secret": this._client_secret,
                "redirect_uri": this._redirect_uri_register,
                "refresh_token": this._token.refresh_token,
                "grant_type": "refresh_token",
                "scope": this._token.scope
            });
            var self = this;
            await axios.post("https://login.microsoftonline.com/common/oauth2/v2.0/token", post_data, { headers: { "Content-Type": "application/x-www-form-urlencoded" } })
                .then(function (resp) {
                    // handle success
                    self._token.time = Date.now();
                    self._token.access_token = resp.data.access_token;
                    self._authed_headers = {
                        "Authorization": "bearer " + self._token.access_token,
                        "Content-Type": "application/json"
                    };
                    //fs.writeFileSync('/tmp/token.json', JSON.stringify(self._token));
                    console.log("Refresh token success!");
                })
                .catch(function (error) {
                    // handle error
                    console.log(error);
                    throw error.response;
                });
        }
        if (!this._token.drive) {
            var self = this;
            await axios.get(this._api_url + "me/drive", { headers: this._authed_headers })
                .then(function (resp) {
                    // handle success
                    self._token.drive = resp.data.id;
                })
                .catch(function (error) {
                    // handle error
                    console.log(error);
                });
        }
    }
    async fetch_list(path = "/") {
        await this.refresh_token();
        const date = new Date();
        console.log("ONEDRIVE: fetch list for " + decodeURI(path) + " in " + date.toLocaleString());
        let req_path = "";
        if (path !== "/") {
            req_path = "/drives/" + this._token.drive + "/root:/" + path.strip("/") + ":/children";
        }
        else req_path = "/drives/" + this._token.drive + "/root/children";
        let content = null;
        await axios.get(this._api_url + req_path + "?&select=id,name,size,folder,image,video,lastModifiedDateTime", { headers: this._authed_headers })
            .then(function (resp) {
                // handle success
                content = resp.data;
            })
            .catch(function (error) {
                // handle error
                console.log(error);
                content = error.response.data;
                throw error.response;
            });
        return content;
    }
    async get_download_link(file_id) {
        await this.refresh_token();
        let link = null;
        await axios.get(this._api_url + "me/drive/items/" + file_id, { headers: this._authed_headers })
            .then(function (resp) {
                // handle success
                if (resp.data.error || resp.data.folder) throw resp;
                else link = resp.data['@microsoft.graph.downloadUrl'];
            })
            .catch(function (error) {
                // handle error
                console.log(error);
                throw error.response;
            })
        return link;
    }
}
const ONEDRIVE = new onedrive_client();
class cache_obj {
    constructor() {
        this.name = new String();
        this.current = new Array();
        this.child = new Array();
        this.parent = null;
        this.time = 0;
        this.lastModifiedDateTime = "";
        this.size = 0;
    }
}

class cache_mgr {
    constructor() {
        this._root_node = new cache_obj();
        this._root_node.name = "root";
        this._root_node.parent = this._root_node;
    }
    async get(path = "/") {
        let cur_node = this._root_node;
        if (path !== "/") {
            let next_path = decodeURI(path.slice(1));
            while (next_path !== "") {
                const cur_folder_name = next_path.slice(0, next_path.indexOf("/"));
                for (let i = 0; i < cur_node.child.length; ++i) {
                    if (cur_node.child[i].name === cur_folder_name) {
                        cur_node = cur_node.child[i];
                        break;
                    }
                }
                if (cur_node.name !== cur_folder_name) //结点不存在
                {
                    let node = new cache_obj();
                    node.name = cur_folder_name;
                    node.parent = cur_node;
                    cur_node.child.push(node);
                    cur_node = node;
                }
                next_path = next_path.slice(next_path.indexOf("/") + 1);
            }

        }
        if (Date.now() - cur_node.time > 600 * 1000) {
            try {
                await this.update(path);
            } catch (e) { //更新缓存出错时
                //缓存无效化
                let e_next_path = decodeURI(path.slice(1));
                let e_cur_node = this._root_node;
                let e_cur_folder_name = e_next_path.slice(0, e_next_path.indexOf("/"));
                while (e_next_path !== "" && e_cur_node.time !== 0) {
                    for (let i = 0; i < e_cur_node.child.length; ++i) {
                        if (e_cur_node.child[i].name === e_cur_folder_name) {
                            e_cur_node = e_cur_node.child[i];
                            break;
                        }
                    }
                    if (e_cur_node.time !== 0) {
                        e_next_path = e_next_path.slice(e_next_path.indexOf("/") + 1);
                        e_cur_folder_name = e_next_path.slice(0, e_next_path.indexOf("/"));
                    }
                }
                e_cur_node = e_cur_node.parent;
                for (let i = 0; i < e_cur_node.child.length; ++i) {
                    if (e_cur_node.child[i].name === e_cur_folder_name) {
                        e_cur_node.child.splice(i, 1);
                        break;
                    }
                }

                return { error: e };
            }
        }
        let ret_arr = [];
        for (let i = 0; i < cur_node.child.length; ++i) {
            ret_arr.push({ name: cur_node.child[i].name, type: "folder", size: cur_node.child[i].size, time: cur_node.child[i].lastModifiedDateTime });
        }
        for (let i = 0; i < cur_node.current.length; ++i) {
            ret_arr.push({ name: cur_node.current[i].name, type: "file", id: cur_node.current[i].id, size: cur_node.current[i].size, time: cur_node.current[i].lastModifiedDateTime });
        }
        return { error: null, list: ret_arr, updated_time: cur_node.time };
    }
    async update(path = "/") {
        let content = null;
        try {
            content = await ONEDRIVE.fetch_list(path);
        } catch (e) {
            throw e;
        }
        const list = content.value;
        let cur_node = this._root_node;
        if (path !== "/") {
            let next_path = decodeURI(path.slice(1));
            while (next_path !== "") {
                const cur_folder_name = next_path.slice(0, next_path.indexOf("/"));
                for (let i = 0; i < cur_node.child.length; ++i) {
                    if (cur_node.child[i].name === cur_folder_name) {
                        cur_node = cur_node.child[i];
                        break;
                    }
                }
                if (cur_node.name !== cur_folder_name) //node not exist
                {
                    let node = new cache_obj();
                    node.name = cur_folder_name;
                    node.parent = cur_node;
                    cur_node.child.push(node);
                    cur_node = node;
                }
                next_path = next_path.slice(next_path.indexOf("/") + 1);
            }

        }
        cur_node.current = [];
        cur_node.child = [];
        for (let i = 0; i < list.length; ++i) {
            if (list[i].folder) {
                let node = new cache_obj();
                node.name = list[i].name;
                let time = list[i].lastModifiedDateTime;
                time = time.slice(0, time.indexOf("T")) + " " + time.slice(time.indexOf("T") + 1, time.indexOf("Z"));
                const size = render_size(list[i].size);
                node.lastModifiedDateTime = time;
                node.size = size;
                node.parent = cur_node;
                cur_node.child.push(node);
            }
            else {
                let time = list[i].lastModifiedDateTime;
                time = time.slice(0, time.indexOf("T")) + " " + time.slice(time.indexOf("T") + 1, time.indexOf("Z"));
                const size = render_size(list[i].size);
                cur_node.current.push({ name: list[i].name, id: list[i].id, lastModifiedDateTime: time, size: size });
            }
        }
        cur_node.time = Date.now();
    }
}
const CACHE = new cache_mgr();

app.get('/favicon.ico', async function (req, res) { res.status(404); res.send(); })
app.get('/*', async function (req, res) {
    const fetch_path = "/" + CONFIG.server.root_path.strip("/") + req.path;
    const fetch_dir = fetch_path.slice(0, fetch_path.lastIndexOf("/") + 1);
    const fetch_file = fetch_path.slice(fetch_path.lastIndexOf("/") + 1);
    const list_folder_content = await CACHE.get(fetch_dir);
    if (list_folder_content.error) {
        res.status(list_folder_content.error.status);
        res.send(list_folder_content.error.status + ' Error: ' + list_folder_content.error.data.error.code);
        return;
    }
    let html = new Object();
    html.list = new Array();
    if (req.path !== "/") html.list.push({ name: "../", time: "-", size: '-' });
    const list = list_folder_content.list;
    for (let i = 0; i < list.length; ++i) {
        if (fetch_file === "") {
            if (list[i].name.indexOf(".password") !== -1) {
                let password = null;
                const auth = req.header('Authorization');
                if (auth) {
                    const info = new Buffer(auth.slice(6), 'base64').toString();
                    password = info.slice(info.indexOf(":") + 1);
                }
                if (password) {
                    const sha1sum = crypto.createHash('sha1');
                    sha1sum.update(password);
                    if (sha1sum.digest('hex') === list[i].name.slice(0, list[i].name.indexOf(".password"))) {
                        continue;
                    }
                }

                const hint = `You need password to access \'${req.path}\'. You just need to input password. Username is not meaningful.`;
                res.set('WWW-Authenticate', `Basic realm=\"${hint}\"`);
                res.set("Content-Type", "text/plain");
                res.status(401);
                res.send(hint);
                return;
            }
            if (list[i].type === "folder") html.list.push({ name: list[i].name + "/", time: list[i].time, size: list[i].size });
            else html.list.push({ name: list[i].name, time: list[i].time, size: list[i].size });
        }
        if (fetch_file === list[i].name) {
            if (!list[i].folder) {
                try {
                    const download_link = await ONEDRIVE.get_download_link(list[i].id);
                    res.redirect(302, download_link);
                }
                catch (e) {
                    res.status(e.status);
                    res.send(e.status + " Error: " + e.data.error.code);
                }
                return;
            }
            else {
                res.redirect(302, req.path + "/");
                return;
            }
        }
    }
    if (fetch_file === "") {
        html.title = "Onedrive directory listing for " + decodeURI(req.path);
        const date = new Date(list_folder_content.updated_time);
        html.time = date.toLocaleString();
        res.set('Content-Type', 'text/html');
        res.render("list.ejs", html);
    }
    else {
        res.status(404);
        res.send("404 Error: File Not Found!");
    }
});

app.listen(CONFIG.test.listen, () => console.log("Run Success!"));