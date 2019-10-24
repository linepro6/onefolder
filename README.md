# onefolder
Onedrive directroy listing by node.js.
## Setup
1. Run `npm install` to install node modules.
2. Get a token from [onefolder-token-generator](https://onefolder-token-generator.linepro.now.sh) ([GitHub Repo](https://github.com/linepro6/onefolder-token-generator)).
3. Create `config.toml` from `config.example.toml`.
4. Initialize your service.
    - Use [ZEIT Now](https://zeit.co)
        ```
        npm install -g now
        now
        ```
    - Use your own server (Nginx proxy recommended)
        ```
        npm serve
        ```
## Feature
1. `HEAD.md` will be displayed before directory listing on web page. (Simple theme is not supported.)
2. `readme.md` will be displayed after directory listing on web page. (Simple theme is not supported.)
3. A password can be provided to protect the current folder. Just add a file named `{SHA1 Hash result from your password}.password` to the folder you want to protect. For example, if you want to protect the root path by password `123`, add a file named `40bd001563085fc35165329ea1ff5c5ecbdbbeef.password` to your root path.
> You just need to input password while authenticating. Username is no use.
4. Files lists will be updated every 10 minutes.
## Demo
https://onefolder.linepro.now.sh