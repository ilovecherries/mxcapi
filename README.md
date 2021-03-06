# contentapi to matrix/discord/both bridge

references:
- [matrix-appservice-bridge howto](https://github.com/matrix-org/matrix-appservice-bridge/blob/develop/HOWTO.md)
- [the slack bridge](https://github.com/matrix-org/matrix-appservice-slack)
- [the original sbs to discord bridge](https://github.com/ilovecherries/discord-sbs-bridge)

## usage

```sh
mkdir data # if it doesn't already exist
```

if using the matrix bridge portion:
- ```sh
  node . -r -u "http://url-to-appservice:8000" # the url here is how the homeserver will try to access the appservice, the port is your choice
  ```  
  this generates a registration file `data/capi-registration.yaml` that you use to register the bridge with a matrix homeserver  
  install the app service like [this](https://docs.mau.fi/bridges/general/registering-appservices.html)

then make a `data/capi.yaml` file:
```yaml
capi:
  url: http://localost:5000 # url to contentapi instance
  username: username
  password: password
matrix: # optional
  homeserver_url: http://matrix-client.matrix.org # http(s) url to your homeserver
  homeserver: matrix.org # what appears in the second half of matrix IDs
  admins: ["@user:server", "@user2:server"] # what users are allowed to bind rooms
discord: # optional
  token: aaaaaaaa
  admins: ["12345", "12346"] # what users are allowed to bind rooms
```
and run
```sh
node . -p 8000 -c data/capi.yaml
# the port needs to be the same one from the previous node command, if bridging to matrix
```

that should be it.

## docker

be aware of networking shenanigans, especially if you're running this on the same machine as the homeserver.

```sh
docker build -t mxcapi . # make sure the image is built
mkdir data # you *may* need to chmod a+w data to allow the node user inside the container to write to the folder

# if using the matrix bridge portion
docker run --rm -v $PWD/data:/appservice/data mxcapi -r -u "http://url-to-appservice:8000"
```

create the `data/capi.yaml` as before

```sh
docker run -v $PWD/data:/appservice/data mxcapi # note: the default cmd is `-p 8000 -c data/capi.yaml`, if you used a different port you'll need to include parameters here
```

## docker-compose for the matrix bridge

if you're running [synapse through docker-compose](https://github.com/matrix-org/synapse/blob/master/contrib/docker/docker-compose.yml), you can add this appservice to your `docker-compose.yaml` file:
```sh
docker build -t mxcapi /path/to/this/repo # make sure the image is built
# run in the same folder as your docker-compose file
mkdir data # you *may* need to chmod a+w data to allow the node user inside the container to write to the folder
docker run --rm -v $PWD/data:/appservice/data mxcapi -r -u "http://mxcapi:8000" # this url can be used verbatim
```
create the `data/capi.yaml` file as before, but use `homeserver_url: http://synapse:8008`
then insert this snippet into your `docker-compose.yaml`
```yaml
# in synapse's volumes section, use this (optional, you can also just copy the file into synapse's data directory manually)
    - ./data/capi-registration.yaml:/data/capi-registration.yaml
# add a new service
mxcapi:
  image: mxcapi
  volumes:
    - ./data:/appservice/data
```
make sure to edit synapse's config to add
```yaml
app_service_config_files:
  - /data/capi-registration.yaml
```

## binding rooms

- make a new room
- matrix: invite `@capi:homeserver`, it should automatically accept the invite
- discord: add the bot to the room
- send `$bind [id]` (e.g. `$bind 937` to bind page 937 to the room) - you need to be in the `admins` list in the corresponding section in `data/capi.yaml` to run this
