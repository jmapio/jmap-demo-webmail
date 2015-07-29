"use strict";

// -------------------------------------------------------------------------- \\
// File: DateJSON.js                                                          \\
// Module: API                                                                \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

Date.prototype.toJSON = function () {
    var year = this.getUTCFullYear(),
        month = this.getUTCMonth() + 1,
        date = this.getUTCDate(),
        hour = this.getUTCHours(),
        minute = this.getUTCMinutes(),
        second = this.getUTCSeconds();
    return (
        ( year < 1000 ?
            '0' + ( year < 100 ? '0' + ( year < 10 ? '0' : '' ) : '' ) + year :
            '' + year ) + '-' +
        ( month < 10 ? '0' + month : '' + month ) + '-' +
        ( date < 10 ? '0' + date : '' + date ) + 'T' +
        ( hour < 10 ? '0' + hour : '' + hour ) + ':' +
        ( minute < 10 ? '0' + minute : '' + minute ) + ':' +
        ( second < 10 ? '0' + second : '' + second )
    );
};


// -------------------------------------------------------------------------- \\
// File: namespace.js                                                         \\
// Module: API                                                                \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

var JMAP = {};


// -------------------------------------------------------------------------- \\
// File: Auth.js                                                              \\
// Module: API                                                                \\
// Requires: namespace.js                                                     \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP ) {

JMAP.auth = new O.Object({

    isAuthenticated: false,

    username: '',
    accessToken: '',

    authenticationUrl: '',
    apiUrl: '',
    eventSourceUrl: '',
    uploadUrl: '',
    downloadUrl: '',

    _isFetchingEndPoints: false,

    // ---

    getUrlForBlob: function ( blobId, name ) {
        return this.get( 'downloadUrl' )
            .replace( '{blobId}', encodeURIComponent( blobId ) )
            .replace( '{name}', encodeURIComponent( name ) );
    },

    // ---

    didAuthenticate: function ( username, accessToken, urls ) {
        for ( var service in urls ) {
            this.set( service, urls[ service ] );
        }
        this.set( 'username', username )
            .set( 'accessToken', accessToken )
            .set( 'isAuthenticated', true );

        this._awaitingAuthentication.forEach( function ( connection ) {
            connection.send();
        });
        this._awaitingAuthentication.length = 0;

        return this;
    },

    refindEndpoints: function () {
        if ( this._isFetchingEndPoints || !this.get( 'isAuthenticated' ) ) {
            return this;
        }
        this._isFetchingEndPoints = true;

        var auth = this;
        new O.HttpRequest({
            timeout: 45000,
            method: 'GET',
            url: this.get( 'authenticationUrl' ),
            headers: {
                'Authorization': this.get( 'accessToken' )
            },
            success: function ( event ) {
                var urls, service;
                try {
                    urls = JSON.parse( event.data );
                }
                catch ( error ) {}

                if ( urls ) {
                    for ( service in urls ) {
                        this.set( service + 'Url', urls[ service ] );
                    }
                }
            }.on( 'io:success' ),
            failure: function ( event ) {
                switch ( event.status ) {
                case 401: // Unauthorized
                    auth.didLoseAuthentication();
                    break;
                case 404: // Not Found
                    // Notify user?
                    break;
                case 500: // Internal Server Error
                    // Notify user?
                    break;
                case 503: // Service Unavailable
                    this.retry();
                }
            }.on( 'io:failure' ),
            retry: function () {
                O.RunLoop.invokeAfterDelay( auth.refindEndpoints, 30000, auth );
            }.on( 'io:abort' ),
            cleanup: function () {
                this.destroy();
                auth._isFetchingEndPoints = false;
            }.on( 'io:end' )
        }).send();

        return this;
    },

    didLoseAuthentication: function () {
        return this.set( 'isAuthenticated', false );
    },

    // ---

    isDisconnected: false,
    timeToReconnect: 0,

    _awaitingAuthentication: [],
    _failedConnections: [],

    _timeToWait: 1,
    _timer: null,

    connectionWillSend: function ( connection ) {
        var isAuthenticated = this.get( 'isAuthenticated' );
        if ( isAuthenticated &&
                !this._failedConnections.contains( connection ) ) {
            return true;
        }
        if ( !isAuthenticated ) {
            this._awaitingAuthentication.include( connection );
        }
        return false;
    },

    connectionFailed: function ( connection, timeToWait ) {
        this._failedConnections.include( connection );
        // If we're not already ticking down...
        if ( !this.get( 'timeToReconnect' ) ) {
            // Is this a reconnection attempt already? Exponentially back off.
            timeToWait = this.get( 'isDisconnected' ) ?
                Math.min( this._timeToWait * 2, 300 ) :
                timeToWait || 1;

            this.set( 'isDisconnected', true )
                .set( 'timeToReconnect', timeToWait + 1 );

            this._timeToWait = timeToWait;
            this._timer =
                O.RunLoop.invokePeriodically( this._tick, 1000, this );
            this._tick();
        }
    },

    connectionSucceeded: function () {
        if ( this.get( 'isDisconnected' ) ) {
            this._timeToWait = 1;
            this.set( 'isDisconnected', false );
        }
    },

    _tick: function () {
        var timeToReconnect = this.get( 'timeToReconnect' ) - 1;
        this.set( 'timeToReconnect', timeToReconnect );
        if ( !timeToReconnect ) {
            this.retryConnections();
        }
    },

    retryConnections: function () {
        var failedConnections = this._failedConnections;
        O.RunLoop.cancel( this._timer );
        this.set( 'timeToReconnect', 0 );
        this._timer = null;
        this._failedConnections = [];
        failedConnections.forEach( function ( connection ) {
            connection.send();
        });
    }
});

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Connection.js                                                        \\
// Module: API                                                                \\
// Requires: Auth.js                                                          \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2014 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP, console, alert */

( function ( JMAP ) {

var delta = function ( update ) {
    var records = update.records,
        changes = update.changes,
        i, l = records.length,
        delta = new Array( l );

    for ( i = 0; i < l; i += 1 ) {
        delta[i] = Object.filter( records[i], changes[i] );
    }
    return delta;
};

var toPrimaryKey = function ( primaryKey, record ) {
    return record[ primaryKey ];
};

var handleProps = {
    precedence: 'commitPrecedence',
    fetch: 'recordFetchers',
    refresh: 'recordRefreshers',
    commit: 'recordCommitters',
    create: 'recordCreators',
    update: 'recordUpdaters',
    destroy: 'recordDestroyers',
    query: 'queryFetchers'
};

/**
    Class: O.Connection

    Extends: O.Source

    An Connection communicates with a server using a JSON protocol conformant
    with the [JMAP](http://jmap.io) standard, allowing multiple fetches and
    commits to be batched into a single HTTP request for efficiency, with
    requests for the same type of object grouped together.

    A request consists of a JSON array, with each element in the array being
    itself an array of three elements, the first a method name, the second an
    object consisting of named arguments, and the third a tag used to associate
    the request with the response:

        [
            [ 'method', {
                arg1: 'foo',
                arg2: 'bar'
            }, '#1' ],
            [ 'method2', {
                foo: [ 'an', 'array' ],
                bar: 42
            }, '#2' ]
        ]

    The response is expected to be in the same format, with methods from
    <O.Connection#response> available to the server to call.
*/
var Connection = O.Class({

    Extends: O.Source,

    /**
        Constructor: O.Connection

        Parameters:
            mixin - {Object} (optional) Any properties in this object will be
                    added to the new O.Object instance before initialisation (so
                    you can pass it getter/setter functions or observing
                    methods). If you don't specify this, your source isn't going
                    to do much!
    */
    init: function ( mixin ) {
        // List of method/args queued for sending in the next request.
        this._sendQueue = [];
        // List of callback functions to be executed after the next request.
        this._callbackQueue = [];

        // Map of id -> RemoteQuery for all queries to be fetched.
        this._queriesToFetch = {};
        // Map of guid( Type ) -> state
        this._typesToRefresh = {};
        // Map of guid( Type ) -> Id -> true
        this._recordsToRefresh = {};
        // Map of guid( Type ) -> null
        this._typesToFetch = {};
        // Map of guid( Type ) -> Id -> true
        this._recordsToFetch = {};

        this._inFlightRemoteCalls = null;
        this._inFlightCallbacks = null;

        this.inFlightRequest = null;

        Connection.parent.init.call( this, mixin );
    },

    prettyPrint: false,

    /**
        Property: O.Connection#willRetry
        Type: Boolean

        If true, retry the request if the connection fails or times out.
    */
    willRetry: true,

    /**
        Property: O.Connection#timeout
        Type: Number

        Time in milliseconds at which to time out the request. Set to 0 for no
        timeout.
    */
    timeout: 30000,

    /**
        Property: O.Connection#inFlightRequest
        Type: (O.HttpRequest|null)

        The HttpRequest currently in flight.
    */
    inFlightRequest: null,

    /**
        Method: O.Connection#ioDidSucceed

        Callback when the IO succeeds. Parses the JSON and passes it on to
        <O.Connection#receive>.

        Parameters:
            event - {IOEvent}
    */
    ioDidSucceed: function ( event ) {
        // Parse data
        var data;
        try {
            data = JSON.parse( event.data );
        } catch ( error ) {}

        // Check it's in the correct format
        if ( !( data instanceof Array ) ) {
            O.RunLoop.didError({
                name: 'O.Connection#ioDidSucceed',
                message: 'Data from server is not JSON.',
                details: 'Data:\n' + event.data +
                    '\n\nin reponse to request:\n' +
                    JSON.stringify( this._inFlightRemoteCalls, null, 2 )
            });
            data = [];
        }

        JMAP.auth.connectionSucceeded( this );

        this.receive(
            data, this._inFlightCallbacks, this._inFlightRemoteCalls );

        this._inFlightRemoteCalls = this._inFlightCallbacks = null;
    }.on( 'io:success' ),

    /**
        Method: O.Connection#ioDidFail

        Callback when the IO fails.

        Parameters:
            event - {IOEvent}
    */
    ioDidFail: function ( event ) {
        var status = event.status,
            serverFailed = ( 500 <= status && status < 600 );
        if ( status === 401 || status === 403 ) {
            JMAP.auth.didLoseAuthentication()
                     .connectionWillSend( this );
        } else if ( !serverFailed && this.get( 'willRetry' ) ) {
            JMAP.auth.connectionFailed( this );
        } else if ( status === 503 ) {
            JMAP.auth.connectionFailed( this, 30 );
        } else {
            if ( serverFailed ) {
                alert( O.loc( 'FEEDBACK_SERVER_FAILED' ) );
            }
            this.receive(
                [], this._inFlightCallbacks, this._inFlightRemoteCalls );
            this._inFlightRemoteCalls = this._inFlightCallbacks = null;
        }
    }.on( 'io:failure', 'io:abort' ),

    /**
        Method: O.Connection#ioDidEnd

        Callback when the IO ends.

        Parameters:
            event - {IOEvent}
    */
    ioDidEnd: function ( event ) {
        // Send any waiting requests
        this.set( 'inFlightRequest', null )
            .send();
        // Destroy old HttpRequest object.
        event.target.destroy();
    }.on( 'io:end' ),

    /**
        Method: O.Connection#callMethod

        Add a method call to be sent on the next request and trigger a request
        to be sent at the end of the current run loop.

        Parameters:
            name     - {String} The name of the method to call.
            args     - {Object} The arguments for the method.
            callback - {Function} (optional) A callback to execute after the
                       request completes successfully.
    */
    callMethod: function ( name, args, callback ) {
        var id = this._sendQueue.length + '';
        this._sendQueue.push([ name, args || {}, id ]);
        if ( callback ) {
            this._callbackQueue.push([ id, callback ]);
        }
        this.send();
        return this;
    },

    addCallback: function ( callback ) {
        this._callbackQueue.push([ '', callback ]);
        return this;
    },

    hasRequests: function () {
        var id;
        if ( this._inFlightRemoteCalls || this._sendQueue.length ) {
            return true;
        }
        for ( id in this._queriesToFetch ) {
            return true;
        }
        for ( id in this._recordsToFetch ) {
            return true;
        }
        for ( id in this._recordsToRefresh ) {
            return true;
        }
        return false;
    },

    headers: function () {
        return {
            'Content-type': 'application/json',
            'Accept': 'application/json',
            'Authorization': JMAP.auth.get( 'accessToken' )
        };
    }.property().nocache(),

    /**
        Method: O.Connection#send

        Send any queued method calls at the end of the current run loop.
    */
    send: function () {
        if ( this.get( 'inFlightRequest' ) ||
                !JMAP.auth.connectionWillSend( this ) ) {
            return;
        }

        var remoteCalls = this._inFlightRemoteCalls,
            request;
        if ( !remoteCalls ) {
            request = this.makeRequest();
            remoteCalls = request[0];
            if ( !remoteCalls.length ) { return; }
            this._inFlightRemoteCalls = remoteCalls;
            this._inFlightCallbacks = request[1];
        }

        this.set( 'inFlightRequest',
            new O.HttpRequest({
                nextEventTarget: this,
                timeout: this.get( 'timeout' ),
                method: 'POST',
                url: JMAP.auth.get( 'apiUrl' ),
                headers: this.get( 'headers' ),
                data: JSON.stringify( remoteCalls,
                    null, this.get( 'prettyPrint' ) ? 2 : 0 )
            }).send()
        );
    }.queue( 'after' ),

    /**
        Method: O.Connection#receive

        After completing a request, this method is called to process the
        response returned by the server.

        Parameters:
            data        - {Array} The array of method calls to execute in
                          response to the request.
            callbacks   - {Array} The array of callbacks to execute after the
                          data has been processed.
            remoteCalls - {Array} The array of method calls that was executed on
                          the server.
    */
    receive: function ( data, callbacks, remoteCalls ) {
        var handlers = this.response,
            i, l, response, handler,
            remoteCallsLength,
            tuple, id, callback, request;
        for ( i = 0, l = data.length; i < l; i += 1 ) {
            response = data[i];
            handler = handlers[ response[0] ];
            if ( handler ) {
                id = response[2];
                request = remoteCalls[+id];
                try {
                    handler.call( this, response[1], request[0], request[1] );
                } catch ( error ) {
                    O.RunLoop.didError( error );
                }
            }
        }
        // Invoke after bindings to ensure all data has propagated through.
        if ( l = callbacks.length ) {
            remoteCallsLength = remoteCalls.length;
            for ( i = 0; i < l; i += 1 ) {
                tuple = callbacks[i];
                id = tuple[0];
                callback = tuple[1];
                if ( id ) {
                    request = remoteCalls[+id];
                    /* jshint ignore:start */
                    response = data.filter( function ( call ) {
                        return call[2] === id;
                    });
                    /* jshint ignore:end */
                    callback = callback.bind( null, response, request );
                }
                O.RunLoop.queueFn( 'middle', callback );
            }
        }
    },

    /**
        Method: O.Connection#makeRequest

        This will make calls to O.Connection#(record|query)(Fetchers|Refreshers)
        to add any final API calls to the send queue, then return a tuple of the
        queue of method calls and the list of callbacks.

        Returns:
            {Array} Tuple of method calls and callbacks.
    */
    makeRequest: function () {
        var sendQueue = this._sendQueue,
            callbacks = this._callbackQueue,
            recordRefreshers = this.recordRefreshers,
            recordFetchers = this.recordFetchers,
            _queriesToFetch = this._queriesToFetch,
            _typesToRefresh = this._typesToRefresh,
            _recordsToRefresh = this._recordsToRefresh,
            _typesToFetch = this._typesToFetch,
            _recordsToFetch = this._recordsToFetch,
            typeId, id, req, state, ids, handler;

        // Query Fetches
        for ( id in _queriesToFetch ) {
            req = _queriesToFetch[ id ];
            handler = this.queryFetchers[ O.guid( req.constructor ) ];
            if ( handler ) {
                handler.call( this, req );
            }
        }

        // Record Refreshers
        for ( typeId in _typesToRefresh ) {
            state = _typesToRefresh[ typeId ];
            handler = recordRefreshers[ typeId ];
            if ( typeof handler === 'string' ) {
                this.callMethod( handler, {
                    sinceState: state
                });
            } else {
                handler.call( this, null, state );
            }
        }
        for ( typeId in _recordsToRefresh ) {
            handler = recordRefreshers[ typeId ];
            ids = Object.keys( _recordsToRefresh[ typeId ] );
            if ( typeof handler === 'string' ) {
                this.callMethod( handler, {
                    ids: ids
                });
            } else {
                recordRefreshers[ typeId ].call( this, ids );
            }
        }

        // Record fetches
        for ( typeId in _typesToFetch ) {
            handler = recordFetchers[ typeId ];
            if ( typeof handler === 'string' ) {
                this.callMethod( handler );
            } else {
                handler.call( this, null );
            }
        }
        for ( typeId in _recordsToFetch ) {
            handler = recordFetchers[ typeId ];
            ids = Object.keys( _recordsToFetch[ typeId ] );
            if ( typeof handler === 'string' ) {
                this.callMethod( handler, {
                    ids: ids
                });
            } else {
                recordFetchers[ typeId ].call( this, ids );
            }
        }

        // Any future requests will be added to a new queue.
        this._sendQueue = [];
        this._callbackQueue = [];

        this._queriesToFetch = {};
        this._typesToRefresh = {};
        this._recordsToRefresh = {};
        this._typesToFetch = {};
        this._recordsToFetch = {};

        return [ sendQueue, callbacks ];
    },

    // ---

    /**
        Method: O.Connection#fetchRecord

        Fetches a particular record from the source. Just passes the call on to
        <O.Connection#fetchRecords>.

        Parameters:
            Type     - {O.Class} The record type.
            id       - {String} The record id.
            callback - {Function} (optional) A callback to make after the record
                       fetch completes (successfully or unsuccessfully).

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchRecord: function ( Type, id, callback ) {
        return this.fetchRecords( Type, [ id ], callback, '', false );
    },

    /**
        Method: O.Connection#fetchAllRecords

        Fetches all records of a particular type from the source. Just passes
        the call on to <O.Connection#fetchRecords>.

        Parameters:
            Type     - {O.Class} The record type.
            state    - {(String|undefined)} The state to update from.
            callback - {Function} (optional) A callback to make after the fetch
                       completes.

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchAllRecords: function ( Type, state, callback ) {
        return this.fetchRecords( Type, null, callback, state || '', !!state );
    },

    /**
        Method: O.Connection#refreshRecord

        Fetches any new data for a record since the last fetch if a handler for
        the type is defined in <O.Connection#recordRefreshers>, or refetches the
        whole record if not.

        Parameters:
            Type     - {O.Class} The record type.
            id       - {String} The record id.
            callback - {Function} (optional) A callback to make after the record
                       refresh completes (successfully or unsuccessfully).

        Returns:
            {Boolean} Returns true if the source handled the refresh.
    */
    refreshRecord: function ( Type, id, callback ) {
        return this.fetchRecords( Type, [ id ], callback, '', true );
    },

    /**
        Method: O.Connection#fetchRecords

        Fetches a set of records of a particular type from the source.

        Parameters:
            Type     - {O.Class} The record type.
            ids      - {(String[]|null)} An array of record ids to fetch, or
                       `null`, indicating that all records of this type should
                       be fetched.
            callback - {Function} (optional) A callback to make after the record
                       fetch completes (successfully or unsuccessfully).

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchRecords: function ( Type, ids, callback, state, _refresh ) {
        var typeId = O.guid( Type ),
            handler = _refresh ?
                this.recordRefreshers[ typeId ] :
                this.recordFetchers[ typeId ];
        if ( _refresh && !handler ) {
            _refresh = false;
            handler = this.recordFetchers[ typeId ];
        }
        if ( !handler ) {
            return false;
        }
        if ( ids ) {
            var reqs = _refresh? this._recordsToRefresh : this._recordsToFetch,
                set = reqs[ typeId ] || ( reqs[ typeId ] = {} ),
                l = ids.length;
            while ( l-- ) {
                set[ ids[l] ] = true;
            }
        } else if ( _refresh ) {
            this._typesToRefresh[ typeId ] = state;
        } else {
            this._typesToFetch[ typeId ] = null;
        }
        if ( callback ) {
            this._callbackQueue.push([ '', callback ]);
        }
        this.send();
        return true;
    },

    /**
        Property: O.Connection#commitPrecedence
        Type: String[Number]|null
        Default: null

        This is on optional mapping of type guids to a number indicating the
        order in which they are to be committed. Types with lower numbers will
        be committed first.
    */
    commitPrecedence: null,

    /**
        Method: O.Connection#commitChanges

        Commits a set of creates/updates/destroys to the source. These are
        specified in a single object, which has record type guids as keys and an
        object with create/update/destroy properties as values. Those properties
        have the following types:

        create  - `[ [ storeKeys... ], [ dataHashes... ] ]`
        update  - `[ [ storeKeys... ], [ dataHashes... ], [changedMap... ] ]`
        destroy - `[ [ storeKeys... ], [ ids... ] ]`

        Each subarray inside the 'create' array should be of the same length,
        with the store key at position 0 in the first array, for example,
        corresponding to the data object at position 0 in the second. The same
        applies to the update and destroy arrays.

        A changedMap, is a map of attribute names to a boolean value indicating
        whether that value has actually changed. Any properties in the data
        which are not in the changed map are presumed unchanged.

        An example call might look like:

            source.commitChanges({
                MyType: {
                    primaryKey: "id",
                    create: {
                        storeKeys: [ "sk1", "sk2" ],
                        records: [{ attr: val, attr2: val2 ...}, {...}]
                    },
                    update: {
                        storeKeys: [ "sk3", "sk4", ... ],
                        records: [{ id: "id3", attr: val ... }, {...}],
                        changes: [{ attr: true }, ... ]
                    },
                    destroy: {
                        storeKeys: [ "sk5", "sk6" ],
                        ids: [ "id5", "id6" ]
                    },
                    state: "i425m515233"
                },
                MyOtherType: {
                    ...
                }
            });

        Any types that are handled by the source are removed from the changes
        object (`delete changes[ typeId ]`); any unhandled types are left
        behind, so the object may be passed to several sources, with each
        handling their own types.

        In a RPC source, this method considers each type in the changes. If that
        type has a handler defined in <O.Connection#recordCommitters>, then this
        will be called with the create/update/destroy object as the sole
        argument, otherwise it will look for separate handlers in
        <O.Connection#recordCreators>, <O.Connection#recordUpdaters> and
        <O.Connection#recordDestroyers>. If handled by one of these, the method
        will remove the type from the changes object.

        Parameters:
            changes  - {Object} The creates/updates/destroys to commit.
            callback - {Function} (optional) A callback to make after the
                       changes have been committed.

        Returns:
            {Boolean} Returns true if any of the types were handled. The
            callback will only be called if the source is handling at least one
            of the types being committed.
    */
    commitChanges: function ( changes, callback ) {
        var types = Object.keys( changes ),
            l = types.length,
            precedence = this.commitPrecedence,
            handledAny = false,
            type, handler, handledType,
            change, create, update, destroy;

        if ( precedence ) {
            types.sort( function ( a, b ) {
                return ( precedence[b] || -1 ) - ( precedence[a] || -1 );
            });
        }

        while ( l-- ) {
            type = types[l];
            change = changes[ type ];
            handler = this.recordCommitters[ type ];
            handledType = false;
            create = change.create;
            update = change.update;
            destroy = change.destroy;
            if ( handler ) {
                if ( typeof handler === 'string' ) {
                    this.callMethod( handler, {
                        state: change.state,
                        create: Object.zip( create.storeKeys, create.records ),
                        update: Object.zip(
                            update.records.map(
                                toPrimaryKey.bind( null, change.primaryKey )
                            ), delta( update )
                        ),
                        destroy: destroy.ids
                    });
                } else {
                    handler.call( this, change );
                }
                handledType = true;
            } else {
                handler = this.recordCreators[ type ];
                if ( handler ) {
                    handler.call( this, create.storeKeys, create.records );
                    handledType = true;
                }
                handler = this.recordUpdaters[ type ];
                if ( handler ) {
                    handler.call( this,
                        update.storeKeys, update.records, update.changes );
                    handledType = true;
                }
                handler = this.recordDestroyers[ type ];
                if ( handler ) {
                    handler.call( this, destroy.storeKeys, destroy.ids );
                    handledType = true;
                }
            }
            if ( handledType ) {
                delete changes[ type ];
            }
            handledAny = handledAny || handledType;
        }
        if ( handledAny && callback ) {
            this._callbackQueue.push([ '', callback ]);
        }
        return handledAny;
    },

    /**
        Method: O.Connection#fetchQuery

        Fetches the data for a remote query from the source.

        Parameters:
            query - {O.RemoteQuery} The query to fetch.

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchQuery: function ( query, callback ) {
        if ( !this.queryFetchers[ O.guid( query.constructor ) ] ) {
            return false;
        }
        var id = query.get( 'id' );

        this._queriesToFetch[ id ] = query;

        if ( callback ) {
            this._callbackQueue.push([ '', callback ]);
        }
        this.send();
        return true;
    },

    /**
        Method: O.Connection#handle

        Helper method to register handlers for a particular type. The handler
        object may include methods with the following keys:

        - precedence: Add function to `commitPrecedence` handlers.
        - fetch: Add function to `recordFetchers` handlers.
        - refresh: Add function to `recordRefreshers` handlers.
        - commit: Add function to `recordCommitters` handlers.
        - create: Add function to `recordCreators` handlers.
        - update: Add function to `recordUpdaters` handlers.
        - destroy: Add function to `recordDestroyers` handlers.
        - query: Add function to `queryFetcher` handlers.

        Any other keys are presumed to be a response method name, and added
        to the `response object.

        Parameters:
            Type     - {O.Class} The type these handlers are for.
            handlers - {string[function]} The handlers. These are registered
                       as described above.

        Returns:
            {O.Connection} Returns self.
    */
    handle: function ( Type, handlers ) {
        var typeId = O.guid( Type ),
            action, propName, isResponse, actionHandlers;
        for ( action in handlers ) {
            propName = handleProps[ action ];
            isResponse = !propName;
            if ( isResponse ) {
                propName = 'response';
            }
            actionHandlers = this[ propName ];
            if ( !this.hasOwnProperty( propName ) ) {
                this[ propName ] = actionHandlers =
                    Object.create( actionHandlers );
            }
            actionHandlers[ isResponse ? action : typeId ] = handlers[ action ];
        }
        return this;
    },

    /**
        Property: O.Connection#recordFetchers
        Type: String[Function]

        A map of type guids to functions which will fetch records of that type.
        The functions will be called with the source as 'this' and a list of ids
        or an object (passed straight through from your program) as the sole
        argument.
    */
    recordFetchers: {},

    /**
        Property: O.Connection#recordRefreshers
        Type: String[Function]

        A map of type guids to functions which will refresh records of that
        type. The functions will be called with the source as 'this' and a list
        of ids or an object (passed straight through from your program) as the
        sole argument.
    */
    recordRefreshers: {},

    /**
        Property: O.Connection#recordCommitters
        Type: String[Function]

        A map of type guids to functions which will commit all creates, updates
        and destroys requested for a particular record type.
    */
    recordCommitters: {},

    /**
        Property: O.Connection#recordCreators
        Type: String[Function]

        A map of type guids to functions which will commit creates for a
        particular record type. The function will be called with the source as
        'this' and will get the following arguments:

        storeKeys - {String[]} A list of store keys.
        data      - {Object[]} A list of the corresponding data object for
                    each store key.

        Once the request has been made, the following callbacks must be made to
        the <O.Store> instance as appropriate:

        * <O.Store#sourceDidCommitCreate> if there are any commited creates.
        * <O.Store#sourceDidNotCreate> if there are any rejected creates.
    */
    recordCreators: {},

    /**
        Property: O.Connection#recordUpdaters
        Type: String[Function]

        A map of type guids to functions which will commit updates for a
        particular record type. The function will be called with the source as
        'this' and will get the following arguments:

        storeKeys - {String[]} A list of store keys.
        data      - {Object[]} A list of the corresponding data object for
                    each store key.
        changed   - {String[Boolean][]} A list of objects mapping attribute
                    names to a boolean value indicating whether that value has
                    actually changed. Any properties in the data has not in the
                    changed map may be presumed unchanged.

        Once the request has been made, the following callbacks must be made to
        the <O.Store> instance as appropriate:

        * <O.Store#sourceDidCommitUpdate> if there are any commited updates.
        * <O.Store#sourceDidNotUpdate> if there are any rejected updates.
    */
    recordUpdaters: {},

    /**
        Property: O.Connection#recordDestroyers
        Type: String[Function]

        A map of type guids to functions which will commit destroys for a
        particular record type. The function will be called with the source as
        'this' and will get the following arguments:

        storeKeys - {String[]} A list of store keys.
        ids       - {String[]} A list of the corresponding record ids.

        Once the request has been made, the following callbacks must be made to
        the <O.Store> instance as appropriate:

        * <O.Store#sourceDidCommitDestroy> if there are any commited destroys.
        * <O.Store#sourceDidNotDestroy> if there are any rejected updates.
    */
    recordDestroyers: {},

    /**
        Property: O.Connection#queryFetchers
        Type: String[Function]

        A map of query type guids to functions which will fetch the requested
        contents of that query. The function will be called with the source as
        'this' and the query as the sole argument.
    */
    queryFetchers: {},

    didFetch: function ( Type, args, isAll ) {
        var store = this.get( 'store' ),
            list = args.list,
            state = args.state,
            notFound = args.notFound;
        if ( list ) {
            store.sourceDidFetchRecords( Type, list, state, isAll );
        }
        if ( notFound ) {
            store.sourceCouldNotFindRecords( Type, notFound );
        }
    },

    didFetchUpdates: function ( Type, args, reqArgs ) {
        var hasDataForChanged = reqArgs.fetchRecords;
        this.get( 'store' )
            .sourceDidFetchUpdates( Type,
                hasDataForChanged ? null : args.changed,
                args.removed,
                args.oldState,
                args.newState
            );
    },

    didCommit: function ( Type, args ) {
        var store = this.get( 'store' ),
            toStoreKey = store.getStoreKey.bind( store, Type ),
            list, object;

        if ( ( object = args.created ) && Object.keys( object ).length ) {
            store.sourceDidCommitCreate( object );
        }
        if ( ( object = args.notCreated ) ) {
            list = Object.keys( object );
            if ( list.length ) {
                store.sourceDidNotCreate( list, true, Object.values( object ) );
            }
        }
        if ( ( list = args.updated ) && list.length ) {
            store.sourceDidCommitUpdate( list.map( toStoreKey ) );
        }
        if ( ( object = args.notUpdated ) ) {
            list = Object.keys( object );
            if ( list.length ) {
                store.sourceDidNotUpdate(
                    list.map( toStoreKey ), Object.values( object ) );
            }
        }
        if ( ( list = args.destroyed ) && list.length ) {
            store.sourceDidCommitDestroy( list.map( toStoreKey ) );
        }
        if ( ( object = args.notDestroyed ) ) {
            list = Object.keys( object );
            if ( list.length ) {
                store.sourceDidNotUpdate(
                    list.map( toStoreKey ), Object.values( object ) );
            }
        }
        if ( args.newState ) {
            store.sourceCommitDidChangeState(
                Type, args.oldState, args.newState );
        }
    },

    /**
        Property: O.Connection#response
        Type: String[Function]

        A map of method names to functions which the server can call in a
        response to return data to the client.
    */
    response: {
        error: function ( args, reqName, reqArgs ) {
            var type = args.type,
                method = 'error_' + reqName + '_' + type,
                response = this.response;
            if ( !response[ method ] ) {
                method = 'error_' + type;
            }
            if ( response[ method ] ) {
                response[ method ].call( this, args, reqName, reqArgs );
            }
        },
        error_unknownMethod: function ( _, requestName ) {
            console.log( 'Unknown API call made: ' + requestName );
        },
        error_invalidArguments: function ( _, requestName, requestArgs ) {
            console.log( 'API call to ' + requestName +
                'made with invalid arguments: ', requestArgs );
        },
        error_accountNotFound: function () {
            // TODO: refetch accounts list.
        },
        error_accountReadOnly: function () {
            // TODO
        },
        error_accountNoMail: function () {
            // TODO: refetch accounts list and clear out any mail data
        },
        error_accountNoContacts: function () {
            // TODO: refetch accounts list and clear out any contacts data
        },
        error_accountNoCalendars: function () {
            // TODO: refetch accounts list and clear out any calendar data
        }
    }
});

JMAP.Connection = Connection;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: connections.js                                                       \\
// Module: API                                                                \\
// Requires: Connection.js                                                    \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP ) {

JMAP.upload = new O.IOQueue({
    maxConnections: 3
});

JMAP.source = new O.AggregateSource({
    sources: [
        JMAP.mail = new JMAP.Connection({
            id: 'mail'
        }),
        JMAP.contacts = new JMAP.Connection({
            id: 'contacts'
        }),
        JMAP.calendar = new JMAP.Connection({
            id: 'calendar'
        }),
        JMAP.peripheral = new JMAP.Connection({
            id: 'peripheral'
        })
    ]
});

JMAP.store = new O.Store({
    source: JMAP.source
});

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Account.js                                                           \\
// Module: API                                                                \\
// Requires: connections.js                                                   \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP ) {

var Record = O.Record,
    attr = Record.attr;

var Account = O.Class({

    Extends: Record,

    name: attr( String ),

    isPrimary: attr( Boolean),
    isReadOnly: attr( Boolean ),

    hasMail: attr( Boolean ),
    hasContacts: attr( Boolean ),
    hasCalendars: attr( Boolean ),

    capabilities: attr( Object )
});

JMAP.peripheral.handle( Account, {
    fetch: 'getAccounts',
    refresh: 'getAccounts',
    // Response handlers
    accounts: function ( args ) {
        this.didFetch( Account, args, true );
    }
});

JMAP.Account = Account;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: LocalFile.js                                                         \\
// Module: API                                                                \\
// Requires: connections.js                                                   \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP ) {

var LocalFile = O.Class({

    Extends: O.Object,

    nextEventTarget: JMAP.upload,

    constrainImageTo: 0,

    init: function ( file ) {
        this.file = file;
        this.blobId = '';

        this.name = file.name ||
            ( 'image.' + ( /\w+$/.exec( file.type ) || [ 'png' ] )[0] );
        this.type = file.type;
        this.size = file.size;

        this.isTooBig = false;
        this.isUploaded = false;
        this.progress = 0;

        LocalFile.parent.init.call( this );
    },

    destroy: function () {
        var request = this._request;
        if ( request ) {
            JMAP.upload.abort( request );
        }
        LocalFile.parent.destroy.call( this );
    },

    upload: function ( obj, key ) {
        if ( obj && key ) {
            obj.removeObserverForKey( key, this, 'upload' );
        }
        if ( !this.isDestroyed ) {
            JMAP.upload.send(
                this._request = new O.HttpRequest({
                    nextEventTarget: this,
                    method: 'POST',
                    url: JMAP.auth.get( 'uploadUrl' ),
                    headers: {
                        'Authorization': JMAP.auth.get( 'accessToken' )
                    },
                    data: this.file
                })
            );
        }
        return this;
    },

    _uploadDidProgress: function () {
        this.set( 'progress', this._request.get( 'uploadProgress' ) );
    }.on( 'io:uploadProgress' ),

    _uploadDidSucceed: function ( event ) {
        var response, property;

        // Parse response.
        try {
            response = JSON.parse( event.data );
        } catch ( error ) {}

        // Was there an error?
        if ( !response ) {
            return this.onFailure( event );
        }

        this.beginPropertyChanges();
        for ( property in response ) {
            // blobId, type, size, expires[, width, height]
            this.set( property, response[ property ] );
        }
        this.set( 'progress', 100 )
            .set( 'isUploaded', true )
            .endPropertyChanges()
            .uploadDidSucceed();
    }.on( 'io:success' ),

    _uploadDidFail: function ( event ) {
        this.set( 'progress', 0 );

        switch ( event.status ) {
        case 400: // Bad Request
        case 415: // Unsupported Media Type
            break;
        case 401: // Unauthorized
            JMAP.auth.didLoseAuthentication()
                     .addObserverForKey( 'isAuthenticated', this, 'upload' );
           break;
        case 404: // Not Found
            JMAP.auth.refindEndpoints()
                     .addObserverForKey( 'uploadUrl', this, 'upload' );
            break;
        case 413: // Request Entity Too Large
            this.set( 'isTooBig', true );
            break;
        default:  // Connection failed or 503 Service Unavailable
            O.RunLoop.invokeAfterDelay( this.upload, 30000, this );
            return;
        }

        this.uploadDidFail();
    }.on( 'io:failure' ),

    _uploadDidEnd: function ( event ) {
        var request = event.target;
        request.destroy();
        if ( this._request === request ) {
            this._request = null;
        }
    }.on( 'io:end' ),

    uploadDidSucceed: function () {},
    uploadDidFail: function () {}
});

JMAP.LocalFile = LocalFile;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Sequence.js                                                          \\
// Module: API                                                                \\
// Requires: namespace.js                                                     \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP ) {

var noop = function () {};

var Sequence = O.Class({

    Extends: O.Object,

    init: function () {
        this.queue = [];
        this.index = 0;
        this.length = 0;
        this.afterwards = noop;

        Sequence.parent.init.call( this );
    },

    then: function ( fn ) {
        this.queue.push( fn );
        this.increment( 'length', 1 );
        return this;
    },

    go: function go ( data ) {
        var index = this.index,
            length = this.length,
            fn = this.queue[ index ];
        if ( index < length ) {
            index += 1;
            this.set( 'index', index );
            fn( go.bind( this ), data );
            if ( index === length ) {
                this.afterwards( index, length );
            }
        }
    },

    cancel: function () {
        var index = this.index,
            length = this.length;
        if ( index < length ) {
            this.set( 'length', 0 );
            this.afterwards( index, length );
        }
    },

    progress: function () {
        var index = this.index,
            length = this.length;
        return length ? Math.round( ( index / length ) * 100 ) : 100;
    }.property( 'index', 'length' )
});

JMAP.Sequence = Sequence;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Calendar.js                                                          \\
// Module: CalendarModel                                                      \\
// Requires: API                                                              \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP, undefined ) {

var Record = O.Record,
    attr = Record.attr;

var Calendar = O.Class({

    Extends: Record,

    name: attr( String, {
        defaultValue: '',
        validate: function ( propValue/*, propKey, record*/ ) {
            if ( !propValue ) {
                return new O.ValidationError( O.ValidationError.REQUIRED,
                    O.loc( 'S_LABEL_REQUIRED' )
                );
            }
            return null;
        }
    }),

    color: attr( String, {
        defaultValue: '#3a429c'
    }),

    sortOrder: attr( Number, {
        defaultValue: 0
    }),

    isVisible: attr( Boolean, {
        defaultValue: true
    }),

    mayReadFreeBusy: attr( Boolean, {
        defaultValue: true
    }),
    mayReadItems: attr( Boolean, {
        defaultValue: true
    }),
    mayAddItems: attr( Boolean, {
        defaultValue: true
    }),
    mayModifyItems: attr( Boolean, {
        defaultValue: true
    }),
    mayRemoveItems: attr( Boolean, {
        defaultValue: true
    }),

    mayRename: attr( Boolean, {
        defaultValue: true
    }),
    mayDelete: attr( Boolean, {
        defaultValue: true
    }),

    mayWrite: function ( mayWrite ) {
        if ( mayWrite !== undefined ) {
            this.set( 'mayAddItems', mayWrite )
                .set( 'mayModifyItems', mayWrite )
                .set( 'mayRemoveItems', mayWrite );
        } else {
            mayWrite = this.get( 'mayAddItems' ) &&
                this.get( 'mayModifyItems' ) &&
                this.get( 'mayRemoveItems' );
        }
        return mayWrite;
    }.property( 'mayAddItems', 'mayModifyItems', 'mayRemoveItems' ),

    cascadeChange: function ( _, key, oldValue, newValue ) {
        var store = this.get( 'store' ),
            calendarId = this.get( 'id' ),
            property = 'calendar-' + key;
        if ( !store.isNested ) {
            store.getAll( JMAP.CalendarEvent, function ( data ) {
                return data.calendarId === calendarId;
            }).forEach( function ( event ) {
                if ( event.get( 'recurrence' ) ) {
                    var cache = event._ocache,
                        id;
                    for ( id in cache ) {
                        cache[ id ].propertyDidChange(
                            property, oldValue, newValue );
                    }
                } else {
                    event.propertyDidChange( property, oldValue, newValue );
                }
            });
        }
    }.observes( 'color', 'name' ),

    calendarWasDestroyed: function () {
        if ( this.get( 'status' ) === O.Status.DESTROYED ) {
            var store = this.get( 'store' ),
                calendarId = this.get( 'id' ),
                eventIds = [];
            if ( !store.isNested ) {
                store.findAll( JMAP.CalendarEvent, function ( data ) {
                    if ( data.calendarId === calendarId ) {
                        eventIds.push( data.id );
                    }
                    return false;
                });
                if ( eventIds.length ) {
                    store.sourceDidDestroyRecords(
                        JMAP.CalendarEvent, eventIds );
                }
            }
        }
    }.observes( 'status' )
});

JMAP.calendar.handle( Calendar, {
    precedence: 1,
    fetch: 'getCalendars',
    refresh: function ( _, state ) {
        this.callMethod( 'getCalendarUpdates', {
            sinceState: state,
            fetchRecords: true
        });
    },
    commit: 'setCalendars',
    // Response handlers
    calendars: function ( args, reqMethod, reqArgs ) {
        this.didFetch( Calendar, args,
            reqMethod === 'getCalendars' && !reqArgs.ids );
    },
    calendarUpdates: function ( args, _, reqArgs ) {
        this.didFetchUpdates( Calendar, args, reqArgs );
    },
    error_getCalendarUpdates_cannotCalculateChanges: function () {
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( Calendar );
    },
    calendarsSet: function ( args ) {
        this.didCommit( Calendar, args );
    }
});

JMAP.Calendar = Calendar;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: RecurringDate.js                                                     \\
// Module: CalendarModel                                                      \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP ) {

// --- Filtering ---

var none = 1 << 15;

var getMonth = function ( date, results ) {
    results[0] = date.getUTCMonth();
    results[1] = none;
    results[2] = none;
};
var getDate = function ( date, results, total ) {
    var daysInMonth = total || Date.getDaysInMonth(
            date.getUTCMonth(), date.getUTCFullYear() ) + 1;
    results[0] = date.getUTCDate();
    results[1] = results[0] - daysInMonth;
    results[2] = none;
};
var getDay = function ( date, results ) {
    results[0] = date.getUTCDay();
    results[1] = none;
    results[2] = none;
};
var getDayMonthly = function ( date, results, total ) {
    var day = date.getUTCDay(),
        monthDate = date.getUTCDate(),
        occurrence = Math.floor( ( monthDate - 1 ) / 7 ) + 1,
        daysInMonth = total || Date.getDaysInMonth(
            date.getUTCMonth(), date.getUTCFullYear() ),
        occurrencesInMonth = occurrence +
            Math.floor( ( daysInMonth - monthDate ) / 7 );
    results[0] = day;
    results[1] = day + ( 7 * occurrence );
    results[2] = day + ( 7 * ( occurrence - occurrencesInMonth - 1 ) );
};
var getDayYearly = function ( date, results, daysInYear ) {
    var day = date.getUTCDay(),
        dayOfYear = date.getDayOfYear( true ),
        occurrence = Math.floor( ( dayOfYear - 1 ) / 7 ) + 1,
        occurrencesInYear = occurrence +
            Math.floor( ( daysInYear - dayOfYear ) / 7 );
    results[0] = day;
    results[1] = day + ( 7 * occurrence );
    results[2] = day + ( 7 * ( occurrence - occurrencesInYear - 1 ) );
};
var getYearDay = function ( date, results, total ) {
    results[0] = date.getYearDay( true );
    results[1] = results[0] - total;
    results[2] = none;
};
var getWeekNo = function ( firstDayOfWeek, date, results, total ) {
    results[0] = date.getISOWeekNumber( firstDayOfWeek, true );
    results[1] = results[0] - total;
    results[2] = none;
};
var getPosition = function ( date, results, total, index ) {
    results[0] = index + 1;
    results[1] = index - total;
    results[2] = none;
};

var filter = function ( array, getValues, allowedValues, total ) {
    var l = array.length,
        results = [ none, none, none ],
        date, i, ll, a, b, c, allowed;
    ll = allowedValues.length;
    outer: while ( l-- ) {
        date = array[l];
        if ( date ) {
            getValues( date, results, total, l );
            a = results[0];
            b = results[1];
            c = results[2];
            for ( i = 0; i < ll; i += 1 ) {
                allowed = allowedValues[i];
                if ( allowed === a || allowed === b || allowed === c ) {
                    continue outer;
                }
            }
            array[l] = null;
        }
    }
};
var expand = function ( array, property, values ) {
    var l = array.length, ll = values.length,
        i, j, k = 0,
        results = new Array( l * ll ),
        candidate, newCandidate;
    for ( i = 0; i < l; i += 1 ) {
        candidate = array[i];
        for ( j = 0; j < ll; j += 1 ) {
            if ( candidate ) {
                newCandidate = new Date( candidate );
                newCandidate[ property ]( values[j] );
            } else {
                newCandidate = null;
            }
            results[ k ] = newCandidate;
            k += 1;
        }
    }
    return results;
};

var numerically = function ( a, b ) {
    return a - b;
};
var toBoolean = O.Transform.toBoolean;

// ---

var YEARLY = 1,
    MONTHLY = 2,
    WEEKLY = 3,
    DAILY = 4,
    HOURLY = 5,
    MINUTELY = 6,
    SECONDLY = 7;

var frequencyNumbers = {
    yearly: YEARLY,
    monthly: MONTHLY,
    weekly: WEEKLY,
    daily: DAILY,
    hourly: HOURLY,
    minutely: MINUTELY,
    secondly: SECONDLY
};

// ---

var RecurringDate = O.Class({

    init: function ( mixin ) {
        this.frequency = mixin.frequency || '';
        this.interval = mixin.interval || 1;

        // [0-6] +- (1/2/3/4/...) * 7 e.g. -1MO => 1 - 7 = -6
        // e.g. [ 0, 1, 9, -5 ]
        this.byDay = mixin.byDay || null;
        this.byDate = mixin.byDate || null;
        this.byMonth = mixin.byMonth || null;
        this.byYearDay = mixin.byYearDay || null;
        this.byWeekNo = mixin.byWeekNo || null;

        var byHour = this.byHour = mixin.byHour || null;
        var byMinute = this.byMinute = mixin.byMinute || null;
        var bySecond = this.bySecond = mixin.bySecond || null;

        if ( byHour ) {
            byHour.sort( numerically );
        }
        if ( byMinute ) {
            byMinute.sort( numerically );
        }
        if ( bySecond ) {
            bySecond.sort( numerically );
        }

        this.bySetPosition = mixin.bySetPosition || null;

        var firstDayOfWeek = mixin.firstDayOfWeek;
        this.firstDayOfWeek =
            0 <= firstDayOfWeek && firstDayOfWeek < 7 ? firstDayOfWeek : 1;

        this.until = mixin.until || null;
        this.count = mixin.count || null;

        this._isComplexAnchor = false;
    },

    toJSON: function () {
        var result = {},
            property, value;

        for ( property in this ) {
            if ( property.charAt( 0 ) !== '_' &&
                    this.hasOwnProperty( property ) ) {
                value = this[ property ];
                if ( value !== null &&
                        ( value !== 1 || property === 'count' ) ) {
                    result[ property ] = value;
                }
            }
        }
        if ( value = result.until ) {
            result.until = value.toJSON();
        }
        return result;
    },

    // Returns the next set of dates revolving around the interval defined by
    // the fromDate. This may include dates *before* the from date.
    iterate: function ( fromDate, startDate ) {
        var frequency = frequencyNumbers[ this.frequency ] || DAILY,
            interval = this.interval,

            firstDayOfWeek = this.firstDayOfWeek,

            byDay = this.byDay,
            byDate = this.byDate,
            byMonth = this.byMonth,
            byYearDay = this.byYearDay,
            byWeekNo = this.byWeekNo,

            byHour = this.byHour,
            byMinute = this.byMinute,
            bySecond = this.bySecond,

            bySetPosition = this.bySetPosition,

            candidates = [],
            maxAttempts =
                ( frequency === YEARLY ) ? 10 :
                ( frequency === MONTHLY ) ? 24 :
                ( frequency === WEEKLY ) ? 53 :
                ( frequency === DAILY ) ? 366 :
                ( frequency === HOURLY ) ? 48 :
                /* MINUTELY || SECONDLY */ 120,
            i, daysInMonth, offset, candidate, lastDayInYear,
            year, month, date, hour, minute, second;

        // Check it's sane.
        if ( interval < 1 ) {
            throw new Error( 'RecurringDate: Cannot have interval < 1' );
        }

        // Ignore illegal restrictions:
        if ( frequency !== YEARLY ) {
            byWeekNo = null;
        }
        switch ( frequency ) {
            case WEEKLY:
                byDate = null;
                /* falls through */
            case DAILY:
            case MONTHLY:
                byYearDay = null;
                break;
        }

        // Only fill-in-the-blanks cases not handled by the fast path.
        if ( frequency === YEARLY ) {
            if ( byDate && !byMonth && !byDay && !byYearDay && !byWeekNo ) {
                if ( byDate.length === 1 &&
                        byDate[0] === fromDate.getUTCDate() ) {
                    byDate = null;
                } else {
                    byMonth = [ fromDate.getUTCMonth() ];
                }
            }
            if ( byMonth && !byDate && !byDay && !byYearDay && !byWeekNo ) {
                byDate = [ fromDate.getUTCDate() ];
            }
        }

        // Deal with monthly/yearly repetitions where the anchor may not exist
        // in some cycles. Must not use fast path.
        if ( this._isComplexAnchor &&
                !byDay && !byDate && !byMonth && !byYearDay && !byWeekNo ) {
            byDate = [ startDate.getUTCDate() ];
            if ( frequency === YEARLY ) {
                byMonth = [ startDate.getUTCMonth() ];
            }
        }

        // It's possible to write rules which don't actually match anything.
        // Limit the maximum number of cycles we are willing to pass through
        // looking for a new candidate.
        while ( maxAttempts-- ) {
            year = fromDate.getUTCFullYear();
            month = fromDate.getUTCMonth();
            date = fromDate.getUTCDate();
            hour = fromDate.getUTCHours();
            minute = fromDate.getUTCMinutes();
            second = fromDate.getUTCSeconds();

            // Fast path
            if ( !byDay && !byDate && !byMonth && !byYearDay && !byWeekNo ) {
                candidates.push( fromDate );
            } else {
                // 1. Build set of candidates.
                switch ( frequency ) {
                // We do the filtering of bySecond/byMinute/byHour in the
                // candidate generation phase for SECONDLY, MINUTELY and HOURLY
                // frequencies.
                case SECONDLY:
                    if ( bySecond && bySecond.indexOf( second ) < 0 ) {
                        break;
                    }
                    /* falls through */
                case MINUTELY:
                    if ( byMinute && byMinute.indexOf( minute ) < 0 ) {
                        break;
                    }
                    /* falls through */
                case HOURLY:
                    if ( byHour && byHour.indexOf( hour ) < 0 ) {
                        break;
                    }
                    /* falls through */
                case DAILY:
                    candidates.push( new Date( Date.UTC(
                        year, month, date, hour, minute, second
                    )));
                    break;
                case WEEKLY:
                    offset = ( fromDate.getUTCDay() - firstDayOfWeek ).mod( 7 );
                    for ( i = 0; i < 7; i += 1 ) {
                        candidates.push( new Date( Date.UTC(
                            year, month, date - offset + i, hour, minute, second
                        )));
                    }
                    break;
                case MONTHLY:
                    daysInMonth = Date.getDaysInMonth( month, year );
                    for ( i = 1; i <= daysInMonth; i += 1 ) {
                        candidates.push( new Date( Date.UTC(
                            year, month, i, hour, minute, second
                        )));
                    }
                    break;
                case YEARLY:
                    candidate = new Date( Date.UTC(
                        year, 0, 1, hour, minute, second
                    ));
                    lastDayInYear = new Date( Date.UTC(
                        year, 11, 31, hour, minute, second
                    ));
                    while ( candidate <= lastDayInYear ) {
                        candidates.push( candidate );
                        candidate = new Date( +candidate + 86400000 );
                    }
                    break;
                }

                // 2. Apply restrictions and expansions
                if ( byMonth ) {
                    filter( candidates, getMonth, byMonth );
                }
                if ( byDate ) {
                    filter( candidates, getDate, byDate,
                        daysInMonth ? daysInMonth + 1 : 0
                    );
                }
                if ( byDay ) {
                    if ( frequency !== MONTHLY &&
                            ( frequency !== YEARLY || byWeekNo ) ) {
                        filter( candidates, getDay, byDay );
                    } else if ( frequency === MONTHLY || byMonth ) {
                        // Filter candidates using position of day in month
                        filter( candidates, getDayMonthly, byDay,
                            daysInMonth || 0 );
                    } else {
                        // Filter candidates using position of day in year
                        filter( candidates, getDayYearly, byDay,
                            Date.getDaysInYear( year ) );
                    }
                }
                if ( byYearDay ) {
                    filter( candidates, getYearDay, byYearDay,
                        // May only be used with YEARLY frequency
                        lastDayInYear.getDayOfYear( true ) + 1
                    );
                }
                if ( byWeekNo ) {
                    filter( candidates, getWeekNo.bind( null, firstDayOfWeek ),
                        byWeekNo,
                        // May only be used with YEARLY frequency
                        lastDayInYear
                            .getISOWeekNumber( firstDayOfWeek, true ) + 1
                    );
                }
            }
            if ( byHour && frequency !== HOURLY &&
                    frequency !== MINUTELY && frequency !== SECONDLY ) {
                candidates = expand( candidates, 'setUTCHours', byHour );
            }
            if ( byMinute &&
                    frequency !== MINUTELY && frequency !== SECONDLY ) {
                candidates = expand( candidates, 'setUTCMinutes', byMinute );
            }
            if ( bySecond && frequency !== SECONDLY ) {
                candidates = expand( candidates, 'setUTCSeconds', bySecond );
            }
            if ( bySetPosition ) {
                candidates = candidates.filter( toBoolean );
                filter( candidates, getPosition, bySetPosition,
                    candidates.length );
            }

            // 3. Increment anchor by frequency/interval
            fromDate = new Date( Date.UTC(
                ( frequency === YEARLY ) ? year + interval : year,
                ( frequency === MONTHLY ) ? month + interval : month,
                ( frequency === WEEKLY ) ? date + 7 * interval :
                ( frequency === DAILY ) ? date + interval : date,
                ( frequency === HOURLY ) ? hour + interval : hour,
                ( frequency === MINUTELY ) ? minute + interval : minute,
                ( frequency === SECONDLY ) ? second + interval : second
            ));

            // 4. Do we have any candidates left?
            candidates = candidates.filter( toBoolean );
            if ( candidates.length ) {
                return [ candidates, fromDate ];
            }
        }
        return [ null, fromDate ];
    },

    // start = Date recurrence starts (should be first occurrence)
    // begin = Beginning of time period to return occurrences within
    // end = End of time period to return occurrences within
    getOccurrences: function ( start, begin, end ) {
        var frequency = frequencyNumbers[ this.frequency ] || DAILY,
            count = this.count || 0,
            until = this.until,
            results = [],
            interval, year, month, date, isComplexAnchor,
            beginYear, beginMonth,
            anchor, temp, occurrences, occurrence, i, l;

        if ( !start ) {
            start = new Date();
        }
        if ( !begin || begin <= start ) {
            begin = start;
        }
        if ( !end && !until && !count ) {
            count = 2;
        }
        if ( until && ( !end || end > until ) ) {
            end = new Date( +until + 1000 );
        }
        if ( end && begin >= end ) {
            return results;
        }

        // An anchor is a date == start + x * (interval * frequency)
        // An anchor may return occurrences earlier than it.
        // Anchor results do not overlap.
        // For monthly/yearly recurrences, we have to generate a "false" anchor
        // and use the slow path if the start date may not exist in some cycles
        // e.g. 31st December repeat monthly -> no 31st in some months.
        year = start.getUTCFullYear();
        month = start.getUTCMonth();
        date = start.getUTCDate();
        isComplexAnchor = this._isComplexAnchor = date > 28 &&
            ( frequency === MONTHLY || (frequency === YEARLY && month === 1) );

        // Must always iterate from the start if there's a count
        if ( count || begin === start ) {
            // Anchor will be created below if complex
            if ( !isComplexAnchor ) {
                anchor = start;
            }
        } else {
            // Find first anchor before or equal to "begin" date.
            interval = this.interval;
            switch ( frequency ) {
            case YEARLY:
                // Get year of range begin.
                // Subtract year of start
                // Find remainder modulo interval;
                // Subtract from range begin year so we're on an interval.
                beginYear = begin.getUTCFullYear();
                year = beginYear - ( ( beginYear - year ) % interval );
                break;
            case MONTHLY:
                beginYear = begin.getUTCFullYear();
                beginMonth = begin.getUTCMonth();
                // Get number of months from event start to range begin
                month = 12 * ( beginYear - year ) + ( beginMonth - month );
                // Calculate the first anchor month <= the begin month/year
                month = beginMonth - ( month % interval );
                year = beginYear;
                // Month could be < 0 if anchor is in previous year
                if ( month < 0 ) {
                    year += Math.floor( month / 12 );
                    month = month.mod( 12 );
                }
                break;
            case WEEKLY:
                interval *= 7;
                /* falls through */
            case DAILY:
                interval *= 24;
                /* falls through */
            case HOURLY:
                interval *= 60;
                /* falls through */
            case MINUTELY:
                interval *= 60;
                /* falls through */
            case SECONDLY:
                interval *= 1000;
                anchor = new Date( begin - ( ( begin - start ) % interval ) );
                break;
            }
        }
        if ( !anchor ) {
            anchor = new Date( Date.UTC(
                year, month, isComplexAnchor ? 1 : date,
                start.getUTCHours(),
                start.getUTCMinutes(),
                start.getUTCSeconds()
            ));
        }

        // If anchor <= start, filter out any dates < start
        // Always filter dates for begin <= date < end
        // If we reach the count limit or find a date >= end, we're done.
        // For sanity, set the count limit to be in the bounds [0,2^14], so
        // we don't enter a near-infinite loop

        if ( count <= 0 || count > 16384 ) {
            count = 16384; // 2 ^ 14
        }

        // Start date is always included according to RFC5545, even if it
        // doesn't match the recurrence
        if ( anchor <= start ) {
            results.push( start );
            count -= 1;
            if ( !count ) {
                return results;
            }
        }

        outer: while ( true ) {
            temp = this.iterate( anchor, start );
            occurrences = temp[0];
            if ( !occurrences ) {
                break;
            }
            if ( anchor <= start ) {
                /* jshint ignore:start */
                occurrences = occurrences.filter( function ( date ) {
                    return date > start;
                });
                /* jshint ignore:end */
            }
            anchor = temp[1];
            for ( i = 0, l = occurrences.length; i < l; i += 1 ) {
                occurrence = occurrences[i];
                if ( end && occurrence >= end ) {
                    break outer;
                }
                if ( begin <= occurrence ) {
                    results.push( occurrence );
                }
                count -= 1;
                if ( !count ) {
                    break outer;
                }
            }
        }

        return results;
    }
});

RecurringDate.fromJSON = function ( recurrenceRule ) {
    var until = recurrenceRule.until;
    if ( until ) {
        recurrenceRule = O.extend({
            until: Date.fromJSON( until )
        }, recurrenceRule, true );
    }
    return new RecurringDate( recurrenceRule );
};

JMAP.RecurringDate = RecurringDate;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: CalendarEvent.js                                                     \\
// Module: CalendarModel                                                      \\
// Requires: API, Calendar.js, RecurringDate.js                               \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP, undefined ) {

var Record = O.Record,
    attr = Record.attr;

var numerically = function ( a, b ) {
    return a - b;
};

var CalendarEvent = O.Class({

    Extends: Record,

    isDragging: false,
    isOccurrence: false,

    mayEdit: function () {
        var calendar = this.get( 'calendar' ),
            organizer = this.get( 'organizer' );
        return calendar.get( 'mayWrite' ) && ( !organizer || organizer.isYou );
    }.property( 'calendar', 'organizer' ),

    isInvitation: function () {
        var organizer = this.get( 'organizer' );
        return ( organizer && !organizer.isYou );
    }.property( 'organizer' ),

    storeWillUnload: function () {
        this._clearOccurrencesCache();
        CalendarEvent.parent.storeWillUnload.call( this );
    },

    // ---

    calendar: Record.toOne({
        Type: JMAP.Calendar,
        key: 'calendarId'
    }),

    summary: attr( String, {
        defaultValue: ''
    }),
    description: attr( String, {
        defaultValue: ''
    }),
    location: attr( String, {
        defaultValue: ''
    }),
    showAsFree: attr( Boolean, {
        defaultValue: false
    }),

    // ---

    isAllDay: attr( Boolean, {
        defaultValue: false
    }),

    // Local Time/Date string, e.g. 2011-03-12T03:04
    start: attr( Date, {
        defaultValue: new Date()
    }),
    end: attr( Date, {
        defaultValue: new Date().add( 1, 'hour' )
    }),

    // TimeZone
    startTimeZone: attr( O.TimeZone, {
        defaultValue: null
    }),
    endTimeZone: attr( O.TimeZone, {
        defaultValue: null
    }),

    getStartDateInTZ: function ( timeZone ) {
        var start = this.get( 'start' );
        var startTimeZone = this.get( 'startTimeZone' );
        var cacheKey;
        if ( startTimeZone ) {
            if ( !timeZone || timeZone === startTimeZone ) {
                return start;
            }
            start = this.get( 'utcStart' );
            cacheKey = timeZone.id + start.toJSON();
            if ( this._ce_sk === cacheKey ) {
                return this._ce_s;
            }
            this._ce_sk = cacheKey;
            this._ce_s = start = timeZone.convertDateToTimeZone( start );
        }
        return start;
    },

    getEndDateInTZ: function ( timeZone ) {
        var end = this.get( 'end' );
        var endTimeZone = this.get( 'endTimeZone' );
        var cacheKey;
        if ( endTimeZone ) {
            if ( !timeZone || timeZone === endTimeZone ) {
                return end;
            }
            end = this.get( 'utcEnd' );
            cacheKey = timeZone.id + end.toJSON();
            if ( this._ce_ek === cacheKey ) {
                return this._ce_e;
            }
            this._ce_ek = cacheKey;
            this._ce_e = end = timeZone.convertDateToTimeZone( end );
        }
        return end;
    },

    utcStart: function ( date ) {
        var timeZone = this.get( 'startTimeZone' );
        if ( date ) {
            this.set( 'start', timeZone ?
                timeZone.convertDateToTimeZone( date ) : date );
        } else {
            date = this.get( 'start' );
            if ( timeZone ) {
                date = timeZone.convertDateToUTC( date );
            }
        }
        return date;
    }.property( 'start', 'startTimeZone' ),

    utcEnd: function ( date ) {
        var timeZone = this.get( 'endTimeZone' );
        if ( date ) {
            this.set( 'end', timeZone ?
                timeZone.convertDateToTimeZone( date ) : date );
        } else {
            date = this.get( 'end' );
            if ( timeZone ) {
                date = timeZone.convertDateToUTC( date );
            }
        }
        return date;
    }.property( 'end', 'endTimeZone', 'isAllDay' ),

    localStart: function ( date ) {
        var start = this.get( 'start' );
        if ( date && !O.isEqual( date, start ) ) {
            this.set( 'end', new Date( +this.get( 'end' ) + ( date - start ) ) )
                .set( 'start', date );
        } else {
            date = start;
        }
        return date;
    }.property( 'start', 'startTimeZone' ).doNotNotify(),

    localEnd: function ( date ) {
        var isAllDay = this.get( 'isAllDay' ),
            timeZone = this.get( 'endTimeZone' ),
            utcStart, utcEnd;
        if ( date ) {
            utcStart = this.get( 'utcStart' );
            utcEnd = timeZone ?
                timeZone.convertDateToUTC( date ) : new Date( date );
            if ( isAllDay ) {
                utcEnd.add( 1, 'day' );
            }
            if ( utcStart > utcEnd ) {
                if ( isAllDay || !utcStart.isOnSameDayAs( utcEnd, true ) ) {
                    this.set( 'utcStart', new Date(
                        +utcStart + ( utcEnd - this.get( 'utcEnd' ) )
                    ));
                } else {
                    utcEnd.add( 1, 'day' );
                    date = new Date( date ).add( 1, 'day' );
                }
            }
            this.set( 'utcEnd', utcEnd );
        } else {
            date = this.get( 'end' );
            if ( isAllDay ) {
                date = new Date( date ).subtract( 1, 'day' );
            }
        }
        return date;
    }.property( 'end', 'endTimeZone', 'isAllDay' ).doNotNotify(),

    // ---

    duration: function ( duration ) {
        var utcStart = this.get( 'utcStart' );
        if ( duration !== undefined ) {
            this.set( 'utcEnd', new Date( +utcStart + duration ) );
        } else {
            duration = this.get( 'utcEnd' ) - utcStart;
        }
        return duration;
    }.property( 'utcStart', 'utcEnd' ),

    // ---

    recurrence: attr( JMAP.RecurringDate, {
        defaultValue: null
    }),

    inclusions: attr( Array, {
        defaultValue: null
    }),

    exceptions: attr( Object, {
        defaultValue: null
    }),

    _updateExceptions: function ( _, __, oldStart ) {
        var exceptions = this.get( 'exceptions' ),
            newExceptions, delta, date;
        if ( this.get( 'store' ).isNested && exceptions ) {
            newExceptions = {};
            delta = this.get( 'start' ) - oldStart;
            for ( date in exceptions ) {
                newExceptions[
                    new Date( +Date.fromJSON( date ) + delta ).toJSON()
                ] = exceptions[ date ];
            }
            this.set( 'exceptions', newExceptions );
        }
    }.observes( 'start' ),

    _removeRecurrence: function () {
        if ( this.get( 'store' ).isNested && !this.get( 'recurrence' ) ) {
            this.set( 'inclusions', null )
                .set( 'exceptions', null );
        }
    }.observes( 'recurrence' ),

    removedDates: function () {
        var exceptions = this.get( 'exceptions' ),
            dates = null,
            date;
        if ( exceptions ) {
            for ( date in exceptions ) {
                if ( !exceptions[ date ] ) {
                    if ( !dates ) { dates = []; }
                    dates.push( Date.fromJSON( date ) );
                }
            }
        }
        if ( dates ) {
            dates.sort( numerically );
        }
        return dates;
    }.property( 'exceptions' ),

    _getOccurrenceForDate: function ( date ) {
        var id = date.toJSON(),
            cache = this._ocache || ( this._ocache = {} );
        return cache[ id ] || ( cache[ id ] =
            new CalendarEventOccurrence( this, id, date )
        );
    },

    getOccurrencesForDateRange: function ( start, end, timeZone ) {
        // Get start time and end time in the event's time zone.
        var eventTimeZone = this.get( 'startTimeZone' ),
            recurrence = this.get( 'recurrence' ),
            inclusions = this.get( 'inclusions' ),
            exceptions = this.get( 'exceptions' ),
            needsFilter = false,
            earliestStart, occurrences,
            i, l, date, index,
            id, exception,
            recurrences;

        // Convert start/end to local time
        if ( timeZone && eventTimeZone && timeZone !== eventTimeZone ) {
            start = timeZone.convertDateToUTC( start );
            start = eventTimeZone.convertDateToTimeZone( start );
            end = timeZone.convertDateToUTC( end );
            end = eventTimeZone.convertDateToTimeZone( end );
        }

        // Calculate earliest possible start date, given duration
        earliestStart = new Date( start - this.get( 'duration' ) + 1000 );

        // Precompute count, as it's expensive to do each time.
        if ( recurrence.count ) {
            occurrences = this.get( 'allStartDates' );
            needsFilter = true;
        } else {
            // Get occurrences that start within the time period:
            occurrences = recurrence.getOccurrences(
                this.get( 'start' ), earliestStart, end
            );

            // Add inclusions
            if ( inclusions ) {
                for ( i = 0, l = inclusions.length; i < l; i += 1 ) {
                    date = inclusions[i];
                    if ( earliestStart <= date && date < end ) {
                        index = occurrences.binarySearch( date );
                        if ( !O.isEqual( occurrences[ index ], date ) ) {
                            occurrences.splice( index, 0, date );
                        }
                    }
                }
            }
            if ( exceptions ) {
                // Remove exceptions
                occurrences = occurrences.filter( function ( date ) {
                    return exceptions[ date.toJSON() ] !== null;
                });
                // Check for crazy time altering weirdness
                for ( id in exceptions ) {
                    exception = exceptions[ id ];
                    if ( exception && ( exception.start || exception.end ) ) {
                        date = Date.fromJSON( id );
                        index = occurrences.binarySearch( date );
                        if ( !O.isEqual( occurrences[ index ], date ) ) {
                            occurrences.splice( index, 0, date );
                        }
                        needsFilter = true;
                    }
                }
            }
        }

        // Get event occurrence objects
        recurrences = occurrences.length ?
            occurrences.map( this._getOccurrenceForDate, this ) : null;

        if ( recurrences && needsFilter ) {
            recurrences = recurrences.filter( function ( occurrence ) {
                return occurrence.get( 'start' ) < end &&
                    occurrence.get( 'end' ) > start -
                    ( occurrence.get( 'isAllDay' ) ? 24 * 60 * 60 * 1000 : 0 );
            });
        }
        return recurrences;
    },

    // Exceptions changing the date/time of an occurrence are ignored: the
    // *original* date/time is still included in the allStartDates array.
    allStartDates: function () {
        var recurrence = this.get( 'recurrence' ),
            inclusions = this.get( 'inclusions' ),
            exceptions = this.get( 'exceptions' ),
            start = this.get( 'start' ),
            dates;

        if ( !recurrence || ( !recurrence.until && !recurrence.count ) ) {
            return [ start ];
        }
        dates = recurrence.getOccurrences( start, null, null );
        if ( inclusions ) {
            dates = dates.concat( inclusions );
            dates.sort( numerically );
            // Deduplicate
            dates = dates.filter( function ( date, index, array ) {
                return !index || !O.isEqual( date, array[ index - 1 ] );
            });
        }
        if ( exceptions ) {
            dates = dates.filter( function ( date ) {
                return exceptions[ date.toJSON() ] !== null;
            });
        }
        return dates;
    }.property( 'start', 'startTimeZone',
        'recurrence', 'inclusions', 'exceptions' ),

    totalOccurrences: function () {
        var recurrence = this.get( 'recurrence' );
        if ( !recurrence ) {
            return 1;
        }
        if ( !recurrence.count && !recurrence.until ) {
            return Number.MAX_VALUE;
        }
        return this.get( 'allStartDates' ).length;
    }.property( 'allStartDates' ),

    _clearOccurrencesCache: function () {
        var cache = this._ocache,
            id;
        if ( cache ) {
            for ( id in cache ) {
                cache[ id ].unload();
            }
            this._ocache = null;
        }
    }.observes( 'start', 'startTimeZone', 'recurrence' ),

    // ---

    alerts: attr( Array, {
        defaultValue: null
    }),

    // ---

    organizer: attr( Object, {
        defaultValue: null
    }),
    attendees: attr( Array, {
        defaultValue: null
    }),

    rsvp: function ( rsvp ) {
        var attendees = this.get( 'attendees' ),
            you;
        if ( rsvp !== undefined ) {
            attendees = O.clone( attendees );
        }
        if ( attendees ) {
            you = attendees.find( function ( participant ) {
                return participant.isYou;
            });
        }
        if ( you && rsvp !== undefined ) {
            you.rsvp = rsvp;
            this.set( 'attendees', attendees );
        } else {
            rsvp = you ? you.rsvp : 'n/a';
        }
        return rsvp;
    }.property( 'attendees' ),

    // ---

    attachments: attr( Array, {
        defaultValue: null
    }),

    isUploading: function () {
        return !!JMAP.calendar.eventUploads.get( this ).length;
    }.property( 'files' ),

    files: function () {
        var attachments = this.get( 'attachments' ) || [];
        return attachments.map( function ( attachment ) {
            return new O.Object( attachment );
        }).concat( JMAP.calendar.eventUploads.get( this ) );
    }.property( 'attachments' ),

    addFile: function ( file ) {
        var attachment = new JMAP.CalendarAttachment( file, this );
        JMAP.calendar.eventUploads.add( this, attachment );
        attachment.upload();
        return this;
    },

    removeFile: function ( file ) {
        if ( file instanceof JMAP.CalendarAttachment ) {
            JMAP.calendar.eventUploads.remove( this, file );
        } else {
            var attachments = this.get( 'attachments' ).slice();
            attachments.splice( this.get( 'files' ).indexOf( file ), 1 );
            this.set( 'attachments', attachments.length ? attachments : null );
        }
        return this;
    }
});

JMAP.calendar.replaceEvents = false;
JMAP.calendar.handle( CalendarEvent, {
    precedence: 2,
    fetch: 'getCalendarEvents',
    refresh: function ( _, state ) {
        this.callMethod( 'getCalendarEventUpdates', {
            sinceState: state,
            maxChanges: 100,
            fetchRecords: true
        });
    },
    commit: 'setCalendarEvents',
    // Response handlers
    calendarEvents: function ( args ) {
        var events = args.list,
            l = events.length,
            event, inclusions;
        while ( l-- ) {
            event = events[l];
            inclusions = event.inclusions;
            if ( inclusions ) {
                event.inclusions = inclusions.map( Date.fromJSON );
            }
        }
        this.didFetch( CalendarEvent, args, this.replaceEvents );
        this.replaceEvents = false;
    },
    calendarEventUpdates: function ( args, _, reqArgs ) {
        this.didFetchUpdates( CalendarEvent, args, reqArgs );
        if ( args.hasMoreUpdates ) {
            this.get( 'store' ).fetchAll( CalendarEvent, true );
        }
    },
    error_getCalendarEventUpdates_cannotCalculateChanges: function () {
        JMAP.calendar.flushCache();
    },
    calendarEventsSet: function ( args ) {
        this.didCommit( CalendarEvent, args );
    }
});

// ---

var proxyOverrideAttibute = function ( Type, key ) {
    return function ( value ) {
        var original = this.get( 'original' ),
            originalValue = this.getOriginalForKey( key ),
            exceptions, overrides;
        if ( value !== undefined ) {
            exceptions = O.clone( original.get( 'exceptions' ) );
            overrides = exceptions && exceptions[ this.id ] || {};
            // If equal to original prop, remove from override.
            if ( O.isEqual( value, originalValue ) ) {
                if ( key in overrides ) {
                    delete overrides[ key ];
                    if ( !Object.keys( overrides ).length ) {
                        delete exceptions[ this.id ];
                    }
                    if ( !Object.keys( exceptions ).length ) {
                        exceptions = null;
                    }
                }
            }
            // Otherwise set in exceptions
            else {
                if ( !exceptions ) {
                    exceptions = {};
                }
                exceptions[ this.id ] = overrides;
                overrides[ key ] = value && value.toJSON ?
                    value.toJSON() : value;
            }
            original.set( 'exceptions', exceptions );
        } else {
            overrides = this.get( 'overrides' );
            value = key in overrides ?
                Type.fromJSON ?
                    Type.fromJSON( overrides[ key ] ) :
                    overrides[ key ] :
                originalValue;
        }
        return value;
    }.property( 'overrides', 'original.' + key );
};

var CalendarEventOccurrence = O.Class({

    Extends: O.Object,

    isDragging: false,
    isOccurrence: true,

    mayEdit: CalendarEvent.prototype.mayEdit,
    isInvitation: CalendarEvent.prototype.isInvitation,

    overrides: O.bind( 'original*exceptions', null, function ( exceptions ) {
        var id = this.toObject.id;
        return exceptions && exceptions[ id ] || {};
    }),

    init: function ( original, id, start ) {
        this._start = start;

        this.id = id;
        this.original = original;
        // For attachment upload only
        this.store = original.get( 'store' );
        this.storeKey = original.get( 'storeKey' ) + id;

        CalendarEventOccurrence.parent.init.call( this );
    },

    getOriginalForKey: function ( key ) {
        var original = this.get( 'original' ),
            startTimeZone, endTimeZone, utcStart, utcEnd;
        switch ( key ) {
        case 'start':
            return this._start;
        case 'end':
            startTimeZone = original.get( 'startTimeZone' );
            endTimeZone = original.get( 'endTimeZone' );
            utcStart = startTimeZone ?
                startTimeZone.convertDateToUTC( this._start ) :
                this._start;
            utcEnd = new Date( +utcStart + original.get( 'duration' ) );
            return endTimeZone ?
                endTimeZone.convertDateToTimeZone( utcEnd ) : utcEnd;
        }
        return original.get( key );
    },

    getDoppelganger: function ( store ) {
        var original = this.get( 'original' ),
            originalStore = original.get( 'store' );
        if ( originalStore === store ) {
            return this;
        }
        return original.getDoppelganger( store )
                       ._getOccurrenceForDate( Date.fromJSON( this.id ) );
    },

    destroy: function () {
        var original = this.get( 'original' ),
            exceptions = original.get( 'exceptions' );
        exceptions = exceptions ? O.clone( exceptions ) : {};
        exceptions[ this.id ] = null;
        original.set( 'exceptions', exceptions );

        this.unload();
    },

    unload: function () {
        CalendarEventOccurrence.parent.destroy.call( this );
    },

    is: function ( status ) {
        return this.get( 'original' ).is( status );
    },

    // ---

    // May not edit calendar prop.
    calendar: O.bind( 'original.calendar' ),

    summary: proxyOverrideAttibute( String, 'summary' ),
    description: proxyOverrideAttibute( String, 'description' ),
    location: proxyOverrideAttibute( String, 'location' ),
    showAsFree: proxyOverrideAttibute( Boolean, 'showAsFree' ),

    // ---

    // May not change isAllDay
    isAllDay: O.bind( 'original.isAllDay' ),

    start: proxyOverrideAttibute( Date, 'start' ),
    end: proxyOverrideAttibute( Date, 'end' ),

    startTimeZone: proxyOverrideAttibute( O.TimeZone, 'startTimeZone' ),
    endTimeZone: proxyOverrideAttibute( O.TimeZone, 'endTimeZone' ),

    getStartDateInTZ: CalendarEvent.prototype.getStartDateInTZ,
    getEndDateInTZ: CalendarEvent.prototype.getEndDateInTZ,

    utcStart: CalendarEvent.prototype.utcStart,
    utcEnd: CalendarEvent.prototype.utcEnd,

    localStart: CalendarEvent.prototype.localStart,
    localEnd: CalendarEvent.prototype.localEnd,

    duration: CalendarEvent.prototype.duration,

    // ---

    // Read-only
    recurrence: O.bind( 'original.recurrence' ),

    inclusions: null,
    exceptions: null,

    removedDates: null,

    index: function () {
        var start = this.get( 'start' ),
            original = this.get( 'original' );
        return O.isEqual( start, original.get( 'start' ) ) ? 0 :
            original.get( 'allStartDates' )
                    .binarySearch( Date.fromJSON( this.get( 'id' ) ) );
    }.property().nocache(),

    allStartDates: function () {
        return this.get( 'original' ).get( 'allStartDates' );
    }.property().nocache(),

    totalOccurrences: function () {
        return this.get( 'original' ).get( 'totalOccurrences' );
    }.property().nocache(),

    // ---

    alerts: proxyOverrideAttibute( Array, 'alerts' ),

    // ---

    organizer: proxyOverrideAttibute( Object, 'organizer' ),
    attendees: proxyOverrideAttibute( Array, 'attendees' ),

    rsvp: O.bindTwoWay( 'original.rsvp' ),

    // ---

    attachments: proxyOverrideAttibute( Array, 'attachments' ),

    isUploading: CalendarEvent.prototype.isUploading,
    files: CalendarEvent.prototype.files,
    addFile: CalendarEvent.prototype.addFile,
    removeFile: CalendarEvent.prototype.removeFile
});

JMAP.CalendarEvent = CalendarEvent;
JMAP.CalendarEventOccurrence = CalendarEventOccurrence;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: InfiniteDateSource.js                                                \\
// Module: CalendarModel                                                      \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP ) {

var InfiniteDateSource = O.Class({

    Extends: O.ObservableArray,

    init: function ( mixin ) {
        InfiniteDateSource.parent.init.call( this, null, mixin );
        this.windowLengthDidChange();
    },

    start: new Date(),

    getNext: function ( date ) {
        return new Date( date ).add( 1 );
    },

    getPrev: function ( date ) {
        return new Date( date ).subtract( 1 );
    },

    windowLength: 10,

    windowLengthDidChange: function () {
        var windowLength = this.get( 'windowLength' ),
            length = this.get( 'length' ),
            anchor, array, i;
        if ( length < windowLength ) {
            anchor = this.last();
            array = this._array;
            for ( i = length; i < windowLength; i += 1 ) {
                array[i] = anchor = anchor ?
                    this.getNext( anchor ) : this.get( 'start' );
            }
            this.rangeDidChange( length, windowLength );
        }
        this.set( 'length', windowLength );
    }.observes( 'windowLength' ),

    shiftWindow: function ( offset ) {
        var current = this._array.slice(),
            length = this.get( 'windowLength' ),
            anchor;
        if ( offset < 0 ) {
            anchor = current[0];
            while ( offset++ ) {
                anchor = this.getPrev( anchor );
                current.unshift( anchor );
            }
            current = current.slice( 0, length );
        } else {
            anchor = current.last();
            while ( offset-- ) {
                anchor = this.getNext( anchor );
                current.push( anchor );
            }
            current = current.slice( -length );
        }
        this.set( '[]', current );
    }
});

JMAP.InfiniteDateSource = InfiniteDateSource;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: calendar-model.js                                                    \\
// Module: CalendarModel                                                      \\
// Requires: API, Calendar.js, CalendarEvent.js                               \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP ) {

var store = JMAP.store;
var Calendar = JMAP.Calendar;
var CalendarEvent = JMAP.CalendarEvent;

// ---

var nonRepeatingEvents = new O.Object({

    index: null,

    clearIndex: function () {
        this.index = null;
    },

    buildIndex: function () {
        var index = this.index = {},
            timeZone = JMAP.calendar.get( 'timeZone' ),
            storeKeys = store.findAll( CalendarEvent, function ( data ) {
                return !data.recurrence;
            }),
            i = 0, l = storeKeys.length,
            event, timestamp, end, events;
        for ( ; i < l; i += 1 ) {
            event = store.materialiseRecord( storeKeys[i], CalendarEvent );
            timestamp = +event.getStartDateInTZ( timeZone );
            timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
            end = +event.getEndDateInTZ( timeZone );
            while ( timestamp < end ) {
                events = index[ timestamp ] || ( index[ timestamp ] = [] );
                events.push( event );
                timestamp += ( 24 * 60 * 60 * 1000 );
            }
        }
        return this;
    },

    getEventsForDate: function ( date ) {
        if ( !this.index ) {
            this.buildIndex();
        }
        var timestamp = +date;
        timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
        return this.index[ timestamp ] || null;
    }
});

var repeatingEvents = new O.Object({

    start: null,
    end: null,
    index: null,

    records: function () {
        var storeKeys = store.findAll( CalendarEvent, function ( data ) {
                return !!data.recurrence;
            }),
            i = 0, l = storeKeys.length,
            records = new Array( l );
        for ( ; i < l; i += 1 ) {
            records[i] = store.materialiseRecord( storeKeys[i], CalendarEvent );
        }
        return records;
    }.property(),

    clearIndex: function () {
        this.computedPropertyDidChange( 'records' );
        this.start = null;
        this.end = null;
        this.index = null;
    },

    buildIndex: function ( date ) {
        var start = this.start = new Date( date ).subtract( 60 );
        var end = this.end = new Date( date ).add( 120 );
        var index = this.index = {},
            timeZone = JMAP.calendar.get( 'timeZone' ),
            records = this.get( 'records' ),
            i = 0, l = records.length,
            event, occurs, j, ll, occurrence,
            timestamp, endStamp, events;

        while ( i < l ) {
            event = records[i];
            occurs = event.getOccurrencesForDateRange( start, end, timeZone );
            for ( j = 0, ll = occurs ? occurs.length : 0; j < ll; j += 1 ) {
                occurrence = occurs[j];
                timestamp = +occurrence.getStartDateInTZ( timeZone );
                timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
                endStamp = +occurrence.getEndDateInTZ( timeZone );
                while ( timestamp < endStamp ) {
                    events = index[ timestamp ] || ( index[ timestamp ] = [] );
                    events.push( occurrence );
                    timestamp += ( 24 * 60 * 60 * 1000 );
                }
            }
            i += 1;
        }
        return this;
    },

    getEventsForDate: function ( date ) {
        if ( !this.index || date < this.start || date >= this.end ) {
            this.buildIndex( date );
        }
        var timestamp = +date;
        timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
        return this.index[ timestamp ] || null;
    }
});

// ---

/*
    If time zone is null -> consider each event in its native time zone.
    Otherwise, consider each event in the time zone given.

    date     - {Date} The date.
*/
var NO_EVENTS = [];
var eventSources = [ nonRepeatingEvents, repeatingEvents ];
var sortByStartInTimeZone = function ( timeZone ) {
    return function ( a, b ) {
        var aStart = a.getStartDateInTZ( timeZone ),
            bStart = b.getStartDateInTZ( timeZone );
        return aStart < bStart ? -1 : aStart > bStart ? 1 : 0;
    };
};

var getEventsForDate = function ( date, timeZone, allDay ) {
    var l = eventSources.length;
    var i, results, events, showDeclined;
    for ( i = 0; i < l; i += 1 ) {
        events = eventSources[i].getEventsForDate( date );
        if ( events ) {
            results = results ? results.concat( events ) : events;
        }
    }

    if ( results ) {
        showDeclined = JMAP.calendar.get( 'showDeclined' );

        // Filter out all-day and invisible calendars.
        results = results.filter( function ( event ) {
            return event.get( 'calendar' ).get( 'isVisible' ) &&
                ( showDeclined || event.get( 'rsvp' ) !== 'no' ) &&
                ( !allDay || event.get( 'isAllDay' ) === ( allDay > 0 ) );
        });

        // And sort
        results.sort( sortByStartInTimeZone( timeZone ) );
    }

    return results || NO_EVENTS;
};

// ---

var eventLists = [];

var EventsList = O.Class({
    Extends: O.ObservableArray,
    init: function ( date, allDay ) {
        this.date = date;
        this.allDay = allDay;

        eventLists.push( this );

        EventsList.parent.init.call( this, getEventsForDate(
            date, JMAP.calendar.get( 'timeZone' ), allDay ));
    },
    destroy: function () {
        eventLists.erase( this );
        EventsList.parent.destroy.call( this );
    },
    recalculate: function () {
        return this.set( '[]', getEventsForDate(
            this.date, JMAP.calendar.get( 'timeZone' ), this.allDay ));
    }
});

// ---

var toUTCDay = function ( date ) {
    return new Date( date - ( date % ( 24 * 60 * 60 * 1000 ) ) );
};
var twelveWeeks = 12 * 7 * 24 * 60 * 60 * 1000;
var now = new Date();

var editStore;

O.extend( JMAP.calendar, {
    editStore: editStore = new O.NestedStore( store ),

    undoManager: new O.StoreUndoManager({
        store: editStore,
        maxUndoCount: 10
    }),

    eventSources: eventSources,
    repeatingEvents: repeatingEvents,
    nonRepeatingEvents: nonRepeatingEvents,

    showDeclined: false,
    timeZone: null,

    loadingEventsStart: now,
    loadingEventsEnd: now,
    loadedEventsStart: now,
    loadedEventsEnd: now,

    // allDay -> 0 (either), 1 (yes), -1 (no)
    getEventsForDate: function ( date, allDay ) {
        this.loadEvents( date );
        return new EventsList( date, allDay );
    },

    loadEvents: function ( date ) {
        var loadingEventsStart = this.loadingEventsStart;
        var loadingEventsEnd = this.loadingEventsEnd;
        var start, end;
        if ( loadingEventsStart === loadingEventsEnd ) {
            start = toUTCDay( date ).subtract( 24, 'week' );
            end = toUTCDay( date ).add( 24, 'week' );
            this.callMethod( 'getCalendarEventList', {
                filter: {
                    after: start,
                    before: end
                },
                fetchCalendarEvents: true
            }, function () {
                JMAP.calendar
                    .set( 'loadedEventsStart', start )
                    .set( 'loadedEventsEnd', end );
            });
            this.loadingEventsStart = start;
            this.loadingEventsEnd = end;
            return;
        }
        if ( date < +loadingEventsStart + twelveWeeks ) {
            start = toUTCDay( date < loadingEventsStart ?
                date : loadingEventsStart
            ).subtract( 24, 'week' );
            this.callMethod( 'getCalendarEventList', {
                filter: {
                    after: start,
                    before: loadingEventsStart
                },
                fetchCalendarEvents: true
            }, function () {
                JMAP.calendar.set( 'loadedEventsStart', start );
            });
            this.loadingEventsStart = start;
        }
        if ( date > +loadingEventsEnd - twelveWeeks ) {
            end = toUTCDay( date > loadingEventsEnd ?
                date : loadingEventsEnd
            ).add( 24, 'week' );
            this.callMethod( 'getCalendarEventList', {
                filter: {
                    after: loadingEventsEnd,
                    before: end
                },
                fetchCalendarEvents: true
            }, function () {
                JMAP.calendar.set( 'loadedEventsEnd', end );
            });
            this.loadingEventsEnd = end;
        }
    },

    clearIndexes: function () {
        nonRepeatingEvents.clearIndex();
        repeatingEvents.clearIndex();
        this.recalculate();
    }.observes( 'timeZone' ),

    recalculate: function () {
        eventLists.forEach( function ( eventList ) {
            eventList.recalculate();
        });
    }.queue( 'before' ).observes( 'showDeclined' ),

    flushCache: function () {
        this.replaceEvents = true;
        this.callMethod( 'getCalendarEventList', {
            filter: {
                after: this.loadedEventsStart,
                before: this.loadedEventsEnd
            },
            fetchCalendarEvents: true
        });
    }
});
store.on( Calendar, JMAP.calendar, 'recalculate' )
     .on( CalendarEvent, JMAP.calendar, 'clearIndexes' );

JMAP.calendar.handle( null, {
    calendarEventList: function () {
        // We don't care about the list, we only use it to fetch the
        // events we want. This may change with search in the future!
    }
});

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: calendarEventUploads.js                                              \\
// Module: CalendarModel                                                      \\
// Requires: API                                                              \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP, undefined ) {

JMAP.calendar.eventUploads = {

    inProgress: {},
    awaitingSave: {},

    get: function ( event ) {
        var id = event.get( 'storeKey' ),
            isEdit = event.get( 'store' ).isNested,
            files = this.inProgress[ id ];

        return files ? files.filter( function ( file ) {
            return isEdit ? file.inEdit : file.inServer;
        }) : [];
    },

    add: function ( event, file ) {
        var id = event.get( 'storeKey' ),
            files = this.inProgress[ id ] || ( this.inProgress[ id ] = [] );
        files.push( file );
        event.computedPropertyDidChange( 'files' );
    },

    remove: function ( event, file ) {
        var id = event.get( 'storeKey' ),
            isEdit = event.get( 'store' ).isNested,
            files = this.inProgress[ id ];

        if ( isEdit && file.inServer ) {
            file.inEdit = false;
        } else {
            files.erase( file );
            if ( !files.length ) {
                delete this.inProgress[ id ];
            }
            file.destroy();
        }
        event.computedPropertyDidChange( 'files' );
    },

    finishEdit: function ( event, source, destination ) {
        var id = event.get( 'storeKey' ),
            files = this.inProgress[ id ],
            l, file;
        if ( files ) {
            l = files.length;
            while ( l-- ) {
                file = files[l];
                if ( !file[ source ] ) {
                    files.splice( l, 1 );
                    file.destroy();
                } else {
                    file[ destination ] = true;
                }
            }
            if ( !files.length ) {
                delete this.inProgress[ id ];
            }
        }
        delete this.awaitingSave[ id ];
    },

    save: function ( event ) {
        var awaitingSave = this.awaitingSave[ event.get( 'storeKey' ) ],
            i, l;
        if ( awaitingSave ) {
            for ( i = 0, l = awaitingSave.length; i < l; i += 1 ) {
                this.keepFile( awaitingSave[i][0], awaitingSave[i][1] );
            }
        }
        this.finishEdit( event, 'inEdit', 'inServer' );
        event.getDoppelganger( JMAP.store )
                 .computedPropertyDidChange( 'files' );
    },

    discard: function ( event ) {
        this.finishEdit( event, 'inServer', 'inEdit' );
        event.getDoppelganger( JMAP.calendar.editStore )
                .computedPropertyDidChange( 'files' );
    },

    didUpload: function ( file ) {
        var inEdit = file.inEdit,
            inServer = file.inServer,
            attachment = {
                url: file.get( 'url' ),
                name: file.get( 'name' ),
                type: file.get( 'type' ),
                size: file.get( 'size' )
            },
            editEvent = file.editEvent,
            editAttachments = O.clone( editEvent.get( 'attachments' ) ) || [],
            id, awaitingSave,
            serverEvent, serverAttachments;

        if ( !inServer ) {
            id = editEvent.get( 'storeKey' );
            awaitingSave = this.awaitingSave;
            ( awaitingSave[ id ] ||
                ( awaitingSave[ id ] = [] ) ).push([
                    file.get( 'path' ), file.get( 'name' ) ]);
            editAttachments.push( attachment );
            editEvent.set( 'attachments', editAttachments );
            this.remove( editEvent, file );
        } else {
            this.keepFile( file.get( 'path' ), file.get( 'name' ) );
            // Save new attachment to server
            serverEvent = editEvent.getDoppelganger( JMAP.store );
            serverAttachments =
                O.clone( serverEvent.get( 'attachments' ) ) || [];
            serverAttachments.push( attachment );
            serverEvent.set( 'attachments', serverAttachments );
            // If in edit, push to edit record as well.
            if ( inEdit ) {
                editAttachments.push( attachment );
            }
            editEvent.set( 'attachments', editAttachments );
            this.remove( serverEvent, file );
        }
    },

    didFail: function ( file ) {
        var event = file.editEvent;
        file.inServer = false;
        this.remove( event, file );
        event.getDoppelganger( JMAP.store )
             .computedPropertyDidChange( 'files' );
    },

    keepFile: function ( path, name ) {
        // Move attachment from temp
        JMAP.mail.callMethod( 'moveFile', {
            path: path,
            newPath: 'att:/cal/' + name,
            createFolders: true,
            mayRename: true
        });
    }
};

var CalendarAttachment = O.Class({

    Extends: JMAP.LocalFile,

    init: function ( file, event ) {
        this.editEvent = event;
        this.inServer = false;
        this.inEdit = true;
        CalendarAttachment.parent.init.call( this, file );
    },

    uploadDidSucceed: function () {
        JMAP.calendar.eventUploads.didUpload( this );
    },
    uploadDidFail: function () {
        JMAP.calendar.eventUploads.didFail( this );
    }
});

JMAP.CalendarAttachment = CalendarAttachment;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: AmbiguousDate.js                                                     \\
// Module: ContactsModel                                                      \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP ) {

var AmbiguousDate = O.Class({

    init: function ( day, month, year ) {
        this.day = day || 0;
        this.month = month || 0;
        this.year = year || 0;
    },

    toJSON: function () {
        return "%'04n-%'02n-%'02n".format(
            this.year, this.month, this.day );
    },

    hasValue: function () {
        return !!( this.day || this.month || this.year );
    },

    yearsAgo: function () {
        if ( !this.year ) { return -1; }
        var now = new Date(),
            ago = now.getFullYear() - this.year,
            nowMonth = now.getMonth(),
            month = ( this.month || 1 ) - 1;
        if ( month > nowMonth ||
                ( month === nowMonth && this.day > now.getDate() ) ) {
            ago -= 1;
        }
        return ago;
    },

    prettyPrint: function () {
        var day = this.day,
            month = this.month,
            year = this.year,
            dateElementOrder = O.i18n.get( 'dateElementOrder' ),
            dayString = day ?
                day + ( year && dateElementOrder === 'mdy' ? ', ' : ' ' ) : '',
            monthString = month ?
                O.i18n.get( 'monthNames' )[ month - 1 ] + ' ' : '',
            yearString = year ? year + ' '  : '';

        return (
            dateElementOrder === 'mdy' ?
                ( monthString + dayString + yearString ) :
            dateElementOrder === 'ymd' ?
                ( yearString + monthString + dayString ) :
                ( dayString + monthString + yearString )
        ).trim();
    }
}).extend({
    fromJSON: function ( json ) {
        var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec( json || '' );
        return parts ?
            new AmbiguousDate( +parts[3], +parts[2], +parts[1] ) : null;
    }
});

JMAP.AmbiguousDate = AmbiguousDate;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Contact.js                                                           \\
// Module: ContactsModel                                                      \\
// Requires: API, AmbiguousDate.js                                            \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP ) {

var Record = O.Record,
    attr = Record.attr;

var Contact = O.Class({

    Extends: Record,

    isFlagged: attr( Boolean, {
        defaultValue: false
    }),

    avatar: attr( Object, {
        defaultValue: null
    }),

    importance: attr( Number, {
        defaultValue: 0
    }),

    prefix: attr( String, {
        defaultValue: ''
    }),
    firstName: attr( String, {
        defaultValue: ''
    }),
    lastName: attr( String, {
        defaultValue: ''
    }),
    suffix: attr( String, {
        defaultValue: ''
    }),

    nickname: attr( String, {
        defaultValue: ''
    }),

    birthday: attr( JMAP.AmbiguousDate, {
        defaultValue: new JMAP.AmbiguousDate( 0, 0, 0 )
    }),
    anniversary: attr( JMAP.AmbiguousDate, {
        defaultValue: new JMAP.AmbiguousDate( 0, 0, 0 )
    }),

    company: attr( String, {
        defaultValue: ''
    }),
    department: attr( String, {
        defaultValue: ''
    }),
    jobTitle: attr( String, {
        defaultValue: ''
    }),

    emails: attr( Array, {
        defaultValue: []
    }),
    phones: attr( Array, {
        defaultValue: []
    }),
    online: attr( Array, {
        defaultValue: []
    }),

    addresses: attr( Array, {
        defaultValue: []
    }),

    notes: attr( String, {
        defaultValue: ''
    }),

    // ---

    groups: function () {
        var contact = this;
        return contact
            .get( 'store' )
            .getAll( JMAP.ContactGroup, null, O.sortByProperties([ 'name' ]) )
            .filter( function ( group ) {
                return group.contains( contact );
           });
    }.property().nocache(),

    // ---

    // Destroy dependent records.
    destroy: function () {
        this.get( 'groups' ).forEach( function ( group ) {
            group.get( 'contacts' ).remove( this );
        }, this );
        Contact.parent.destroy.call( this );
    },

    // ---

    name: function () {
        var name = ( this.get( 'firstName' ) + ' ' +
            this.get( 'lastName' ) ).trim();
        if ( !name ) {
            name = this.get( 'company' );
        }
        return name;
    }.property( 'firstName', 'lastName', 'company' ),

    emailName: function () {
        var name = this.get( 'name' ).replace( /["\\]/g, '' );
        if ( /[,;@]/.test( name ) ) {
            name = '"' + name + '"';
        }
        return name;
    }.property( 'name' ),

    defaultEmailIndex: function () {
        var emails = this.get( 'emails' ),
            i, l;
        for ( i = 0, l = emails.length; i < l; i += 1 ) {
            if ( emails[i].isDefault ) {
                return i;
            }
        }
        return 0;
    }.property( 'emails' ),

    defaultEmail: function () {
        var email = this.get( 'emails' )[ this.get( 'defaultEmailIndex' ) ];
        return email ? email.value : '';
    }.property( 'emails' ),

    defaultNameAndEmail: function () {
        var name = this.get( 'emailName' ),
            email = this.get( 'defaultEmail' );
        return email ? name ? name + ' <' + email + '>' : email : '';
    }.property( 'emailName', 'defaultEmail' )
});

JMAP.contacts.handle( Contact, {
    precedence: 0, // Before ContactGroup
    fetch: 'getContacts',
    refresh: function ( _, state ) {
        this.callMethod( 'getContactUpdates', {
            sinceState: state,
            maxChanges: 100,
            fetchRecords: true
        });
    },
    commit: 'setContacts',
    // Response handlers
    contacts: function ( args, reqMethod, reqArgs ) {
        this.didFetch( Contact, args,
            reqMethod === 'getContacts' && !reqArgs.ids );
    },
    contactUpdates: function ( args, _, reqArgs ) {
        this.didFetchUpdates( Contact, args, reqArgs );
        if ( args.hasMoreUpdates ) {
            this.get( 'store' ).fetchAll( Contact, true );
        }
    },
    error_getContactUpdates_cannotCalculateChanges: function () {
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( Contact );
    },
    contactsSet: function ( args ) {
        this.didCommit( Contact, args );
    }
});

JMAP.Contact = Contact;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: ContactGroup.js                                                      \\
// Module: ContactsModel                                                      \\
// Requires: API, Contact.js                                                  \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP ) {

var Record = O.Record,
    attr = Record.attr;

var ValidationError = O.ValidationError;
var REQUIRED = ValidationError.REQUIRED;

var ContactGroup = O.Class({

    Extends: Record,

    name: attr( String, {
        defaultValue: '',
        validate: function ( propValue/*, propKey, record*/ ) {
            if ( !propValue ) {
                return new ValidationError( REQUIRED,
                    O.loc( 'S_LABEL_REQUIRED' )
                );
            }
            return null;
        }
    }),

    contacts: Record.toMany({
        recordType: JMAP.Contact,
        key: 'contactIds',
        defaultValue: [],
        // Should really check that either:
        // (a) This is not a shared group and not a shared contact
        // (a) The user has write access to shared contacts AND
        //   (i)  The contact is shared
        //   (ii) The group is
        // (b) Is only adding/removing non-shared groups (need to compare
        //     new array to old array)
        // However, given the UI does not allow illegal changes to be made
        // (group is disabled in groups menu) and the server enforces this,
        // we don't bother checking it.
        willSet: function () {
            return true;
        }
    }),

    contactIndex: function () {
        return this.get( 'contacts' ).reduce( function ( index, contact ) {
            index[ contact.get( 'storeKey' ) ] = true;
            return index;
        }, {} );
    }.property( 'contacts' ),

    contains: function ( contact ) {
        return !!this.get( 'contactIndex' )[ contact.get( 'storeKey' ) ];
    }
});

JMAP.contacts.handle( ContactGroup, {
    precedence: 1, // After Contact
    fetch: 'getContactGroups',
    refresh: function ( _, state ) {
        this.callMethod( 'getContactGroupUpdates', {
            sinceState: state,
            fetchRecords: true
        });
    },
    commit: 'setContactGroups',
    // Response handlers
    contactGroups: function ( args, reqMethod, reqArgs ) {
        this.didFetch( ContactGroup, args,
            reqMethod === 'getContactGroups' && !reqArgs.ids );
    },
    contactGroupUpdates: function ( args, _, reqArgs ) {
        this.didFetchUpdates( ContactGroup, args, reqArgs );
    },
    error_getContactGroupUpdates_cannotCalculateChanges: function () {
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( ContactGroup );
    },
    contactGroupsSet: function ( args ) {
        this.didCommit( ContactGroup, args );
    }
});

JMAP.ContactGroup = ContactGroup;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: contacts-model.js                                                    \\
// Module: ContactsModel                                                      \\
// Requires: API, Contact.js                                                  \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP ) {

var contactsIndex = new O.Object({
    index: null,
    clearIndex: function () {
        this.index = null;
    },
    buildIndex: function () {
        var index = this.index = {},
            Contact = JMAP.Contact,
            store = JMAP.store,
            storeKeys = store.findAll( Contact ),
            i, l, contact, emails, ll;
        for ( i = 0, l = storeKeys.length; i < l; i += 1 ) {
            contact = store.materialiseRecord( storeKeys[i], Contact );
            emails = contact.get( 'emails' );
            ll = emails.length;
            while ( ll-- ) {
                index[ emails[ll].value.toLowerCase() ] = contact;
            }
        }
        return index;
    },
    getIndex: function () {
        return this.index || this.buildIndex();
    }
});
JMAP.store.on( JMAP.Contact, contactsIndex, 'clearIndex' );

var editStore = new O.NestedStore( JMAP.store );

O.extend( JMAP.contacts, {
    editStore: editStore,

    undoManager: new O.StoreUndoManager({
        store: editStore,
        maxUndoCount: 10
    }),

    getContactFromEmail: function ( email ) {
        var index = contactsIndex.getIndex();
        return index[ email.toLowerCase() ] || null;
    }
});

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Mailbox.js                                                           \\
// Module: MailModel                                                          \\
// Requires: API                                                              \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP ) {

var Record = O.Record,
    attr = Record.attr;

var ValidationError = O.ValidationError;
var REQUIRED        = ValidationError.REQUIRED;
var TOO_LONG        = ValidationError.TOO_LONG;

var Mailbox = O.Class({

    Extends: Record,

    name: attr( String, {
        defaultValue: '',
        validate: function ( propValue/*, propKey, record*/ ) {
            if ( !propValue ) {
                return new ValidationError( REQUIRED,
                    O.loc( 'S_LABEL_REQUIRED' )
                );
            }
            if ( propValue.length > 256 ) {
                return new ValidationError( TOO_LONG,
                    O.loc( 'S_MAIL_ERROR_MAX_CHARS', 256 )
                );
            }
            return null;
        }
    }),

    parent: Record.toOne({
        Type: Mailbox,
        key: 'parentId',
        defaultValue: null
    }),

    role: attr( String, {
        defaultValue: null
    }),

    sortOrder: attr( Number, {
        defaultValue: 10
    }),

    // ---

    mustBeOnlyMailbox: attr( Boolean, {
        defaultValue: true,
        noSync: true
    }),
    mayReadItems: attr( Boolean, {
        defaultValue: true,
        noSync: true
    }),
    mayAddItems: attr( Boolean, {
        defaultValue: true,
        noSync: true
    }),
    mayRemoveItems: attr( Boolean, {
        defaultValue: true,
        noSync: true
    }),
    mayCreateChild: attr( Boolean, {
        defaultValue: true,
        noSync: true
    }),
    mayRename: attr( Boolean, {
        defaultValue: true,
        noSync: true
    }),
    mayDelete: attr( Boolean, {
        defaultValue: true,
        noSync: true
    }),

    // ---

    totalMessages: attr( Number, {
        defaultValue: 0,
        noSync: true
    }),
    unreadMessages: attr( Number, {
        defaultValue: 0,
        noSync: true
    }),
    totalThreads: attr( Number, {
        defaultValue: 0,
        noSync: true
    }),
    unreadThreads: attr( Number, {
        defaultValue: 0,
        noSync: true
    }),

    // ---

    displayName: function () {
        return this.get( 'name' );
    }.property( 'name' ),

    subfolders: function () {
        var storeKey = this.get( 'storeKey' ),
            store = this.get( 'store' );
        return storeKey ?
            store.getAll( Mailbox,
                function ( data ) {
                    return data.parentId === storeKey;
                },
                O.sortByProperties([ 'sortOrder', 'name' ])
            ) :
            new O.RecordArray( store, Mailbox, [] );
    }.property().nocache(),

    depth: function () {
        var parent = this.get( 'parent' );
        return parent ? parent.get( 'depth' ) + 1 : 0;
    }.property( 'parent' ),

    depthDidChange: function ( _, __, oldDepth ) {
        if ( oldDepth !== this.get( 'depth' ) ) {
            this.get( 'subfolders' ).forEach( function ( mailbox ) {
                mailbox.computedPropertyDidChange( 'depth' );
            });
        }
    }.observes( 'depth' ),

    // ---

    moveTo: function ( dest, where ) {
        var sub = ( where === 'sub' ),
            parent = sub ? dest : dest.get( 'parent' ),
            siblings = parent ?
                parent.get( 'subfolders' ) :
                this.get( 'store' ).getQuery( 'rootMailboxes', O.LiveQuery, {
                    Type: Mailbox,
                    filter: function ( data ) {
                        return !data.parentId;
                    },
                    sort: [ 'sortOrder', 'name' ]
                }),
            index = sub ? 0 :
                siblings.indexOf( dest ) + ( where === 'next' ? 1 : 0 ),
            prev = index ? siblings.getObjectAt( index - 1 ) : null,
            next = siblings.getObjectAt( index ),
            prevPrec = prev ? prev.get( 'sortOrder' ) : 0,
            nextPrec = next ? next.get( 'sortOrder' ) : ( index + 2 ) * 32,
            i, p, l, folder;

        if ( nextPrec - prevPrec < 2 ) {
            for ( i = 0, p = 32, l = siblings.get( 'length' );
                    i < l; i += 1, p += 32 ) {
                folder = siblings.getObjectAt( i );
                if ( folder !== this ) {
                    folder.set( 'sortOrder', p );
                    if ( folder === prev ) {
                        p += 32;
                    }
                }
            }
            if ( prev ) { prevPrec = prev.get( 'sortOrder' ); }
            if ( next ) { nextPrec = next.get( 'sortOrder' ); }
        }
        this.set( 'parent', parent || null )
            .set( 'sortOrder', ( nextPrec + prevPrec ) >> 1 );
    },

    // ---

    destroy: function () {
        // Check ACL
        if ( this.get( 'mayDelete' ) ) {
            // Destroy dependent records
            this.get( 'subfolders' ).forEach( function ( folder ) {
                folder.destroy();
            });
            Mailbox.parent.destroy.call( this );
        }
    }
});

Mailbox.prototype.parent.Type = Mailbox;

JMAP.mail.handle( Mailbox, {
    precedence: 0,
    fetch: function ( ids ) {
        this.callMethod( 'getMailboxes', {
            ids: ids || null,
            properties: null
        });
    },
    refresh: function ( ids, state ) {
        if ( ids ) {
            this.callMethod( 'getMailboxes', {
                ids: ids,
                properties: [
                    'totalMessages', 'unreadMessages',
                    'totalThreads', 'unreadThreads'
                ]
            });
        } else {
            this.callMethod( 'getMailboxUpdates', {
                sinceState: state,
                fetchRecords: true,
                fetchRecordProperties: null
            });
        }
    },
    commit: 'setMailboxes',

    // ---

    mailboxes: function ( args, reqMethod, reqArgs ) {
        this.didFetch( Mailbox, args,
            reqMethod === 'getMailboxes' && !reqArgs.ids );
    },

    mailboxUpdates: function ( args, _, reqArgs ) {
        this.didFetchUpdates( Mailbox, args, reqArgs );
    },
    error_getMailboxUpdates_cannotCalculateChanges: function () {
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( Mailbox );
    },

    mailboxesSet: function ( args ) {
        this.didCommit( Mailbox, args );
    }
});

JMAP.Mailbox = Mailbox;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Message.js                                                           \\
// Module: MailModel                                                          \\
// Requires: API, Mailbox.js                                                  \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP, undefined ) {

var Status = O.Status,
    EMPTY = Status.EMPTY,
    READY = Status.READY,
    NEW = Status.NEW;

var Record = O.Record,
    attr = Record.attr;

var MessageDetails = O.Class({ Extends: Record });

var Message = O.Class({

    Extends: Record,

    threadId: attr( String ),

    thread: function () {
        var threadId = this.get( 'threadId' );
        return threadId ?
            this.get( 'store' ).getRecord( JMAP.Thread, threadId ) : null;
    }.property( 'threadId' ).nocache(),

    mailboxes: Record.toMany({
        recordType: JMAP.Mailbox,
        key: 'mailboxIds'
    }),

    isUnread: attr( Boolean ),
    isFlagged: attr( Boolean ),
    isAnswered: attr( Boolean ),
    isDraft: attr( Boolean ),
    hasAttachment: attr( Boolean ),

    from: attr( Object ),
    to: attr( Array ),
    subject: attr( String ),
    date: attr( Date ),

    size: attr( Number ),

    preview: attr( String ),

    // ---

    isIn: function ( role ) {
        return this.get( 'mailboxes' ).some( function ( mailbox ) {
            return mailbox.get( 'role' ) === role;
        });
    },
    isInTrash: function () {
        return this.isIn( 'trash' );
    }.property( 'mailboxes' ),

    notifyThread: function () {
        var threadId = this.get( 'threadId' ),
            store = this.get( 'store' );
        if ( threadId &&
                ( store.getRecordStatus( JMAP.Thread, threadId ) & READY ) ) {
            this.get( 'thread' ).propertyDidChange( 'messages' );
        }
    }.queue( 'before' ).observes( 'mailboxes',
        'isUnread', 'isFlagged', 'isDraft', 'hasAttachment' ),

    // ---

    fromName: function () {
        var from = this.get( 'from' );
        return from ? from.name || from.email.split( '@' )[0] : '';
    }.property( 'from' ),

    fromEmail: function () {
        var from = this.get( 'from' );
        return from ? from.email : '';
    }.property( 'from' ),

    // ---

    detailsStatus: function ( status ) {
        if ( status !== undefined ) {
            return status;
        }
        if ( this.get( 'blobId' ) || this.is( NEW ) ) {
            return READY;
        }
        return EMPTY;
    }.property( 'blobId' ),

    fetchDetails: function () {
        if ( this.get( 'detailsStatus' ) === EMPTY ) {
            JMAP.mail.fetchRecord( MessageDetails, this.get( 'id' ) );
        }
    },

    blobId: attr( String ),

    inReplyToMessageId: attr( String ),

    headers: attr( Object, {
        defaultValue: {}
    }),

    cc: attr( Array ),
    bcc: attr( Array ),
    replyTo: attr( Object ),

    textBody: attr( String ),
    htmlBody: attr( String ),

    attachments: attr( Array ),
    attachedMessages: attr( Object ),
    attachedInvites: attr( Object )
}).extend({
    headerProperties: [
        'threadId',
        'mailboxIds',
        'isUnread',
        'isFlagged',
        'isAnswered',
        'isDraft',
        'hasAttachment',
        'from',
        'to',
        'subject',
        'date',
        'size',
        'preview'
    ],
    detailsProperties: [
        'blobId',
        'inReplyToMessageId',
        'headers.List-Id',
        'headers.List-Post',
        'cc',
        'bcc',
        'replyTo',
        'body',
        'attachments',
        'attachedMessages',
        'attachedInvites'
    ],
    Details: MessageDetails
});

JMAP.mail.handle( MessageDetails, {
    fetch: function ( ids ) {
        this.callMethod( 'getMessages', {
            ids: ids,
            properties: Message.detailsProperties
        });
    }
});

JMAP.mail.messageUpdateFetchRecords = true;
JMAP.mail.messageUpdateMaxChanges = 50;
JMAP.mail.handle( Message, {
    fetch: function ( ids ) {
        this.callMethod( 'getMessages', {
            ids: ids,
            properties: Message.headerProperties
        });
    },
    refresh: function ( ids, state ) {
        if ( ids ) {
            this.callMethod( 'getMessages', {
                ids: ids,
                properties: [
                    'mailboxIds',
                    'isUnread',
                    'isFlagged',
                    'isAnswered',
                    'isDraft',
                    'hasAttachment'
                ]
            });
        } else {
            var messageUpdateFetchRecords = this.messageUpdateFetchRecords;
            this.callMethod( 'getMessageUpdates', {
                sinceState: state,
                maxChanges: this.messageUpdateMaxChanges,
                fetchRecords: messageUpdateFetchRecords,
                fetchRecordProperties: messageUpdateFetchRecords ?
                    Message.headerProperties : null
            });
        }
    },
    commit: 'setMessages',

    // ---

    messages: function ( args ) {
        var first = args.list[0],
            updates;
        if ( first && first.date ) {
            this.didFetch( Message, args );
        } else {
            updates = args.list.reduce( function ( updates, message ) {
                updates[ message.id ] = message;
                return updates;
            }, {} );
            this.get( 'store' )
                .sourceDidFetchPartialRecords( Message, updates );
        }
    },
    messageUpdates: function ( args, _, reqArgs ) {
        this.didFetchUpdates( Message, args, reqArgs );
        if ( !reqArgs.fetchRecords ) {
            this.recalculateAllFetchedWindows();
        }
        if ( args.hasMoreUpdates ) {
            var messageUpdateMaxChanges = this.messageUpdateMaxChanges;
            if ( messageUpdateMaxChanges < 150 ) {
                if ( messageUpdateMaxChanges === 50 ) {
                    // Keep fetching updates, just without records
                    this.messageUpdateFetchRecords = false;
                    this.messageUpdateMaxChanges = 100;
                } else {
                    this.messageUpdateMaxChanges = 150;
                }
                this.get( 'store' ).fetchAll( Message, true );
                return;
            } else {
                // We've fetched 300 updates and there's still more. Let's give
                // up and reset.
                this.response
                    .error_getMessageUpdates_cannotCalculateChanges
                    .call( this, args );
            }
        }
        this.messageUpdateFetchRecords = true;
        this.messageUpdateMaxChanges = 50;
    },
    error_getMessageUpdates_cannotCalculateChanges: function ( args ) {
        var store = this.get( 'store' );
        // All our data may be wrong. Mark all messages as obsolete.
        // The garbage collector will eventually clean up any messages that
        // no longer exist
        store.getAll( Message ).forEach( function ( message ) {
            message.setObsolete();
        });
        this.recalculateAllFetchedWindows();
        // Tell the store we're now in the new state.
        store.sourceDidFetchUpdates(
            Message, null, null, store.getTypeState( Message ), args.newState );

    },
    messagesSet: function ( args ) {
        this.didCommit( Message, args );
    }
});

JMAP.Message = Message;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Thread.js                                                            \\
// Module: MailModel                                                          \\
// Requires: API, Message.js                                                  \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP ) {

var Record = O.Record;

var aggregateBoolean = function ( _, key ) {
    return this.get( 'messages' ).reduce( function ( isProperty, message ) {
        return isProperty || ( !message.isIn( 'trash' ) && message.get( key ) );
    }, false );
}.property( 'messages' ).nocache();

var aggregateBooleanInTrash = function ( _, key ) {
    return this.get( 'messages' ).reduce( function ( isProperty, message ) {
        return isProperty || ( message.isIn( 'trash' ) && message.get( key ) );
    }, false );
}.property( 'messages' ).nocache();

var Thread = O.Class({

    Extends: Record,

    isEditable: false,

    messages: Record.toMany({
        recordType: JMAP.Message,
        key: 'messageIds'
    }),

    isAll: function ( status ) {
        return this.is( status ) &&
            this.get( 'messages' ).every( function ( message ) {
                return message.is( status );
            });
    },

    // Note: API Mail mutates this value; do not cache.
    mailboxCounts: function () {
        var counts = {};
        this.get( 'messages' ).forEach( function ( message ) {
            message.get( 'mailboxes' ).forEach( function ( mailbox ) {
                var id = mailbox.get( 'id' );
                if ( message.get( 'isInTrash' ) &&
                        mailbox.get( 'role' ) !== 'trash' ) {
                    return;
                }
                counts[ id ] = ( counts[ id ] ||  0 ) + 1;
            });
        });
        return counts;
    }.property( 'messages' ).nocache(),

    isUnread: aggregateBoolean,
    isFlagged: aggregateBoolean,
    isDraft: aggregateBoolean,
    hasAttachment: aggregateBoolean,

    total: function () {
        return this.get( 'messages' ).reduce( function ( count, message ) {
            return count + ( message.isIn( 'trash' ) ? 0 : 1 );
        }, 0 );
    }.property( 'messages' ).nocache(),

    // senders is [{name: String, email: String}]
    senders: function () {
        return this.get( 'messages' ).map( function ( message ) {
            return message.isIn( 'trash' ) ? null : message.get( 'from' );
        }).filter( O.Transform.toBoolean );
    }.property( 'messages' ).nocache(),

    size: function () {
        return this.get( 'messages' ).reduce( function ( size, message ) {
            return size +
                ( message.isIn( 'trash' ) ? 0 : message.get( 'size' ) );
        }, 0 );
    }.property( 'messages' ).nocache(),

    // ---

    isUnreadInTrash: aggregateBooleanInTrash,
    isFlaggedInTrash: aggregateBooleanInTrash,
    isDraftInTrash: aggregateBooleanInTrash,
    hasAttachmentInTrash: aggregateBooleanInTrash,

    totalInTrash: function () {
        return this.get( 'messages' ).reduce( function ( count, message ) {
            return count + ( message.isIn( 'trash' ) ? 1 : 0 );
        }, 0 );
    }.property( 'messages' ).nocache(),

    sendersInTrash: function () {
        return this.get( 'messages' ).map( function ( message ) {
            return message.isIn( 'trash' ) ? message.get( 'from' ) : null;
        }).filter( O.Transform.toBoolean );
    }.property( 'messages' ).nocache(),

    sizeInTrash: function () {
        return this.get( 'messages' ).reduce( function ( size, message ) {
            return size +
                ( message.isIn( 'trash' ) ? message.get( 'size' ) : 0 );
        }, 0 );
    }.property( 'messages' ).nocache()
});

JMAP.mail.threadUpdateFetchRecords = true;
JMAP.mail.threadUpdateMaxChanges = 30;
JMAP.mail.handle( Thread, {
    fetch: function ( ids ) {
        this.callMethod( 'getThreads', {
            ids: ids,
            fetchMessages: true,
            fetchMessageProperties: JMAP.Message.headerProperties
        });
    },
    refresh: function ( ids, state ) {
        if ( ids ) {
            this.fetchRecords( Thread, ids );
        } else {
            this.callMethod( 'getThreadUpdates', {
                sinceState: state,
                maxChanges: this.threadUpdateMaxChanges,
                fetchRecords: this.threadUpdateFetchRecords
            });
        }
    },
    // Response handler
    threads: function ( args ) {
        this.didFetch( Thread, args );
    },
    threadUpdates: function ( args, _, reqArgs ) {
        this.didFetchUpdates( Thread, args, reqArgs );
        if ( !reqArgs.fetchRecords ) {
            this.recalculateAllFetchedWindows();
        }
        if ( args.hasMoreUpdates ) {
            var threadUpdateMaxChanges = this.threadUpdateMaxChanges;
            if ( threadUpdateMaxChanges < 120 ) {
                if ( threadUpdateMaxChanges === 30 ) {
                    // Keep fetching updates, just without records
                    this.threadUpdateFetchRecords = false;
                    this.threadUpdateMaxChanges = 100;
                } else {
                    this.threadUpdateMaxChanges = 120;
                }
                this.get( 'store' ).fetchAll( Thread, true );
                return;
            } else {
                // We've fetched 250 updates and there's still more. Let's give
                // up and reset.
                this.response
                    .error_getThreadUpdates_cannotCalculateChanges
                    .call( this, args );
            }
        }
        this.threadUpdateFetchRecords = true;
        this.threadUpdateMaxChanges = 30;
    },
    error_getThreadUpdates_cannotCalculateChanges: function ( args ) {
        var store = this.get( 'store' );
        // All our data may be wrong. Unload if possible, otherwise mark
        // obsolete.
        store.getAll( Thread ).forEach( function ( thread ) {
            if ( !store.unloadRecord( thread.get( 'storeKey' ) ) ) {
                thread.setObsolete();
            }
        });
        this.recalculateAllFetchedWindows();
        // Tell the store we're now in the new state.
        store.sourceDidFetchUpdates(
            Thread, null, null, store.getTypeState( Thread ), args.newState );
    }
});

JMAP.Thread = Thread;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: MessageList.js                                                       \\
// Module: MailModel                                                          \\
// Requires: API, Message.js, Thread.js                                       \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP, undefined ) {

var Status = O.Status,
    EMPTY = Status.EMPTY,
    OBSOLETE = Status.OBSOLETE;

var isFetched = function ( message ) {
    return !message.is( EMPTY|OBSOLETE );
};
var refresh = function ( record ) {
    if ( record.is( OBSOLETE ) ) {
        record.refresh();
    }
};

var EMPTY_SNIPPET = {
    body: ' '
};

var stringifySorted = function ( item ) {
    if ( !item || ( typeof item !== 'object' ) ) {
        return JSON.stringify( item );
    }
    if ( item instanceof Array ) {
        return '[' + item.map( stringifySorted ).join( ',' ) + ']';
    }
    var keys = Object.keys( item );
    keys.sort();
    return '{' + keys.map( function ( key ) {
        return '"' + key + '":' + stringifySorted( item[ key ] );
    }).join( ',' ) + '}';
};

var getId = function ( args ) {
    return 'ml:' + stringifySorted( args.filter ) +
        ( args.collapseThreads ? '+' : '-' );
};

var MessageList = O.Class({

    Extends: O.WindowedRemoteQuery,

    optimiseFetching: true,

    sort: [ 'date desc' ],
    collapseThreads: true,

    Type: JMAP.Message,

    init: function ( options ) {
        this._snippets = {};
        this._snippetsNeeded = [];

        this.messageToThreadId = {};

        MessageList.parent.init.call( this, options );
    },

    // Precondition: All ids are fetched for the window to be checked.
    checkIfWindowIsFetched: function ( index ) {
        var store = this.get( 'store' ),
            Type = this.get( 'Type' ),
            windowSize = this.get( 'windowSize' ),
            list = this._list,
            i = index * windowSize,
            l = Math.min( i + windowSize, this.get( 'length' ) ),
            collapseThreads = this.get( 'collapseThreads' ),
            messageToThreadId = this.messageToThreadId,
            messageId, threadId, thread;
        for ( ; i < l; i += 1 ) {
            messageId = list[i];
            // No message, or out-of-date
            if ( store.getRecordStatus( Type, messageId ) & (EMPTY|OBSOLETE) ) {
                return false;
            }
            if ( collapseThreads ) {
                threadId = messageToThreadId[ messageId ];
                // No thread, or out-of-date
                if ( store.getRecordStatus( JMAP.Thread, threadId ) &
                        (EMPTY|OBSOLETE) ) {
                    return false;
                }
                thread = store.getRecord( JMAP.Thread, threadId );
                return thread.get( 'messages' ).every( isFetched );
            }
        }
        return true;
    },

    sourceWillFetchQuery: function () {
        var req = MessageList.parent.sourceWillFetchQuery.call( this );

        // If we have all the ids already, optimise the loading of the records.
        var store = this.get( 'store' ),
            list = this._list,
            length = this.get( 'length' ),
            collapseThreads = this.get( 'collapseThreads' ),
            messageToThreadId = this.messageToThreadId,
            threadId;

        req.records = req.records.filter( function ( req ) {
            var i = req.start,
                l = i + req.count,
                message, thread;

            if ( length ) {
                l = Math.min( l, length );
            }

            while ( i < l ) {
                var id = list[i];
                if ( id ) {
                    i += 1;
                } else {
                    id = list[ l - 1 ];
                    if ( !id ) { break; }
                    l -= 1;
                }
                // Fetch the Message objects (if not already fetched).
                // If already fetched, fetch the updates
                if ( collapseThreads ) {
                    threadId = messageToThreadId[ id ];
                    thread = store.getRecord( JMAP.Thread, threadId );
                    // If already fetched, fetch the updates
                    refresh( thread );
                    thread.get( 'messages' ).forEach( refresh );
                } else {
                    message = store.getRecord( JMAP.Message, id );
                    refresh( message );
                }
            }
            req.start = i;
            req.count = l - i;
            return i !== l;
        });

        return req;
    },

    // --- Snippets ---

    sourceDidFetchSnippets: function ( snippets ) {
        var store = JMAP.store,
            Message = JMAP.Message,
            READY = O.Status.READY,
            l = snippets.length,
            snippet, messageId;
        while ( l-- ) {
            snippet = snippets[l];
            messageId = snippet.messageId;
            this._snippets[ messageId ] = snippet;
            if ( store.getRecordStatus( Message, messageId ) & READY ) {
                // There is no "snippet" property, but this triggers the
                // observers of * property changes on the object.
                store.getRecord( Message, messageId )
                     .propertyDidChange( 'snippet' );
            }
        }
    },

    getSnippet: function ( messageId ) {
        var snippet = this._snippets[ messageId ];
        if ( !snippet ) {
            this._snippetsNeeded.push( messageId );
            this._snippets[ messageId ] = snippet = EMPTY_SNIPPET;
            this.fetchSnippets();
        }
        return snippet;
    },

    fetchSnippets: function () {
        JMAP.mail.callMethod( 'getSearchSnippets', {
            messageIds: this._snippetsNeeded,
            filter: this.get( 'filter' ),
            // Not part of the getSearchSnippets call, but needed to identify
            // this list again to give the response to.
            collapseThreads: this.get( 'collapseThreads' )
        });
        this._snippetsNeeded = [];
    }.queue( 'after' )
});

JMAP.mail.handle( MessageList, {
    query: function ( query ) {
        var filter = query.get( 'filter' ),
            sort = query.get( 'sort' ),
            collapseThreads = query.get( 'collapseThreads' ),
            canGetDeltaUpdates = query.get( 'canGetDeltaUpdates' ),
            state = query.get( 'state' ),
            request = query.sourceWillFetchQuery(),
            hasMadeRequest = false;

        if ( canGetDeltaUpdates && state && request.refresh ) {
            var list = query._list,
                length = list.length,
                upto = ( length === query.get( 'length' ) ) ?
                    undefined : list[ length - 1 ];
            this.callMethod( 'getMessageListUpdates', {
                filter: filter,
                sort: sort,
                collapseThreads: collapseThreads,
                sinceState: state,
                uptoMessageId: upto,
                maxChanges: 250
            });
        }

        if ( request.callback ) {
            this.addCallback( request.callback );
        }

        var get = function ( start, count, anchor, offset, fetchData ) {
            hasMadeRequest = true;
            this.callMethod( 'getMessageList', {
                filter: filter,
                sort: sort,
                collapseThreads: collapseThreads,
                position: start,
                anchor: anchor,
                anchorOffset: offset,
                limit: count,
                fetchThreads: collapseThreads && fetchData,
                fetchMessages: fetchData,
                fetchMessageProperties: fetchData ?
                    JMAP.Message.headerProperties : null,
                fetchSearchSnippets: false
            });
        }.bind( this );

        request.ids.forEach( function ( req ) {
            get( req.start, req.count, undefined, undefined, false );
        });
        request.records.forEach( function ( req ) {
            get( req.start, req.count, undefined, undefined, true );
        });
        request.indexOf.forEach( function ( req ) {
            get( undefined, 5, req[0], 1, false );
            this.addCallback( req[1] );
        }, this );

        if ( ( ( query.get( 'status' ) & O.Status.EMPTY ) &&
                !request.records.length ) ||
             ( !canGetDeltaUpdates && !hasMadeRequest && request.refresh ) ) {
            get( 0, 30, undefined, undefined, true );
        }
    },

    // ---

    messageList: function ( args ) {
        var store = this.get( 'store' ),
            query = store.getQuery( getId( args ) ),
            messageToThreadId, messageIds, threadIds, l;

        if ( query &&
                args.collapseThreads === query.get( 'collapseThreads' ) ) {
            messageToThreadId = query.messageToThreadId;
            threadIds = args.threadIds;
            messageIds = args.idList = args.messageIds;
            l = messageIds.length;
            while ( l-- ) {
                messageToThreadId[ messageIds[l] ] = threadIds[l];
            }
            query.set( 'canGetDeltaUpdates', args.canCalculateUpdates );
            query.sourceDidFetchIdList( args );
        }
    },

    error_getMessageList_anchorNotFound: function (/* args */) {
        // Don't need to do anything; it's only used for doing indexOf,
        // and it will just check that it doesn't have it.
    },

    messageListUpdates: function ( args ) {
        var store = this.get( 'store' ),
            query = store.getQuery( getId( args ) ),
            messageToThreadId;

        if ( query &&
                args.collapseThreads === query.get( 'collapseThreads' ) ) {
            messageToThreadId = query.messageToThreadId;
            args.upto = args.uptoMessageId;
            args.removed = args.removed.map( function ( obj ) {
                delete messageToThreadId[ obj.messageId ];
                return obj.messageId;
            });
            args.added = args.added.map( function ( obj ) {
                messageToThreadId[ obj.messageId ] = obj.threadId;
                return [ obj.index, obj.messageId ];
            });
            query.sourceDidFetchUpdate( args );
        }
    },

    error_getMessageListUpdates_cannotCalculateChanges: function ( _, __, requestArgs ) {
        this.response.error_getMessageListUpdates_tooManyChanges
            .call( this,  _, __, requestArgs );
    },

    error_getMessageListUpdates_tooManyChanges: function ( _, __, requestArgs ) {
        var query = this.get( 'store' ).getQuery( getId( requestArgs ) );
        if ( query ) {
            query.reset();
        }
    },

    // ---

    searchSnippets: function ( args ) {
        var store = this.get( 'store' ),
            query = store.getQuery( getId( args ) );
        if ( query ) {
            query.sourceDidFetchSnippets( args.list );
        }
    }
});

JMAP.mail.recalculateAllFetchedWindows = function () {
    // Mark all message lists as needing to recheck if window is fetched.
    this.get( 'store' ).getAllRemoteQueries().forEach( function ( query ) {
        if ( query instanceof MessageList ) {
            query.recalculateFetchedWindows();
        }
    });
};

MessageList.getId = getId;

JMAP.MessageList = MessageList;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: mail-model.js                                                        \\
// Module: MailModel                                                          \\
// Requires: API, Mailbox.js, Thread.js, Message.js, MessageList.js           \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP ) {

var store = JMAP.store;
var Mailbox = JMAP.Mailbox;
var Thread = JMAP.Thread;
var Message = JMAP.Message;
var MessageList = JMAP.MessageList;

// --- Preemptive mailbox count updates ---

var getMailboxDelta = function ( deltas, mailboxId ) {
    return deltas[ mailboxId ] || ( deltas[ mailboxId ] = {
        totalMessages: 0,
        unreadMessages: 0,
        totalThreads: 0,
        unreadThreads: 0,
        removed: [],
        added: []
    });
};

var updateMailboxCounts = function ( mailboxDeltas ) {
    var mailboxId, delta, mailbox;
    for ( mailboxId in mailboxDeltas ) {
        delta = mailboxDeltas[ mailboxId ];
        mailbox = store.getRecord( Mailbox, mailboxId );
        if ( delta.totalMessages ) {
            mailbox.increment( 'totalMessages', delta.total );
        }
        if ( delta.unreadMessages ) {
            mailbox.increment( 'unreadMessages', delta.unread );
        }
        if ( delta.totalThreads ) {
            mailbox.increment( 'totalThreads', delta.totalThreads );
        }
        if ( delta.unreadThreads ) {
            mailbox.increment( 'unreadThreads', delta.unreadThreads );
        }
        // Fetch the real counts, just in case. We set it obsolete
        // first, so if another fetch is already in progress, the
        // results of that are discarded and it is fetched again.
        mailbox.setObsolete()
               .refresh();
    }
};

// --- Preemptive query updates ---

var isSortedOnUnread = function ( sort ) {
    for ( var i = 0, l = sort.length; i < l; i += 1 ) {
        if ( /isUnread/.test( sort[i] ) ) {
            return true;
        }
    }
    return false;
};
var isFilteredOnUnread = function ( filter ) {
    if ( filter.operator ) {
        return filter.conditions.some( isFilteredOnUnread );
    }
    return 'isUnread' in filter;
};
var isSortedOnFlagged = function ( sort ) {
    for ( var i = 0, l = sort.length; i < l; i += 1 ) {
        if ( /isFlagged/.test( sort[i] ) ) {
            return true;
        }
    }
    return false;
};
var isFilteredOnFlagged = function ( filter ) {
    if ( filter.operator ) {
        return filter.conditions.some( isFilteredOnFlagged );
    }
    return 'isFlagged' in filter;
};
var isFilteredOnMailboxes = function ( filter ) {
    if ( filter.operator ) {
        return filter.conditions.some( isFilteredOnMailboxes );
    }
    return 'inMailboxes' in filter;
};
var isFilteredJustOnMailbox = function ( filter ) {
    var isJustMailboxes = false,
        term;
    for ( term in filter ) {
        if ( term === 'inMailboxes' && filter[ term ].length === 1 ) {
            isJustMailboxes = true;
        } else {
            isJustMailboxes = false;
            break;
        }
    }
    return isJustMailboxes;
};
var isTrue = function () {
    return true;
};
var isFalse = function () {
    return false;
};

// ---

var reOrFwd = /^(?:(?:re|fwd):\s*)+/;
var comparators = {
    id: function ( a, b ) {
        var aId = a.get( 'id' );
        var bId = b.get( 'id' );

        return aId < bId ? -1 : aId > bId ? 1 : 0;
    },
    date: function ( a, b ) {
        return a.get( 'date' ) - b.get( 'date' );
    },
    size: function ( a, b ) {
        return a.get( 'size' ) - b.get( 'size' );
    },
    from: function ( a, b ) {
        var aFrom = a.get( 'from' );
        var bFrom = b.get( 'from' );
        var aFromPart = aFrom ? aFrom.name || aFrom.email : '';
        var bFromPart = bFrom ? bFrom.name || bFrom.email : '';

        return aFromPart < bFromPart ? -1 : aFromPart > bFromPart ? 1 : 0;
    },
    to: function ( a, b ) {
        var aTo = a.get( 'to' );
        var bTo = b.get( 'to' );
        var aToPart = aTo && aTo.length ? aTo[0].name || aTo[0].email : '';
        var bToPart = bTo && bTo.length ? bTo[0].name || bTo[0].email : '';

        return aToPart < bToPart ? -1 : aTo > bToPart ? 1 : 0;
    },
    subject: function ( a, b ) {
        var aSubject = a.get( 'subject' ).replace( reOrFwd, '' );
        var bSubject = b.get( 'subject' ).replace( reOrFwd, '' );

        return aSubject < bSubject ? -1 : aSubject > bSubject ? 1 : 0;
    },
    isFlagged: function ( a, b ) {
        var aFlagged = a.get( 'isFlagged' );
        var bFlagged = b.get( 'isFlagged' );

        return aFlagged === bFlagged ? 0 :
            aFlagged ? -1 : 1;
    },
    isFlaggedThread: function ( a, b ) {
        return comparators.isFlagged( a.get( 'thread' ), b.get( 'thread' ) );
    }
};

var compareToId = function ( fields, id, message ) {
    var otherMessage = id && ( store.getRecordStatus( Message, id ) & READY ) ?
            store.getRecord( Message, id ) : null;
    var i, l, comparator, result;
    if ( !otherMessage ) {
        return 1;
    }
    for ( i = 0, l = fields.length; i < l; i += 1 ) {
        comparator = comparators[ fields[i][0] ];
        if ( comparator && ( result = comparator( otherMessage, message ) ) ) {
            return result * fields[i][1];
        }
    }
    return 0;
};

var compareToMessage = function ( fields, aData, bData ) {
    var a = aData.message;
    var b = bData.message;
    var i, l, comparator, result;
    for ( i = 0, l = fields.length; i < l; i += 1 ) {
        comparator = comparators[ fields[i] ];
        if ( comparator && ( result = comparator( a, b ) ) ) {
            return result;
        }
    }
    return 0;
};

var splitDirection = function ( fields, collapseThreads ) {
    return fields.map( function ( field ) {
        var space = field.indexOf( ' ' ),
            prop = space ? field.slice( 0, space ) : field,
            dir = space && field.slice( space + 1 ) === 'asc' ? 1 : -1;

        if ( collapseThreads && /^is/.test( prop ) ) {
            prop += 'Thread';
        }
        return [ prop, dir ];
    });
};

var calculatePreemptiveAdd = function ( query, addedMessages ) {
    var idList = query._list;
    var sort = splitDirection(
        query.get( 'sort' ), query.get( 'collapseThreads' ) );
    var comparator = compareToId.bind( null, sort );
    var added = addedMessages.reduce( function ( added, message ) {
            var messageId = message.get( 'id' );
            if ( messageId ) {
                added.push({
                    message: message,
                    messageId: messageId,
                    threadId: message.get( 'threadId' ),
                    // Can't insert draft messages for now; would need to use
                    // store keys in the remote quries instead of message ids.
                    index: messageId ?
                        idList.binarySearch( message, comparator ) : -1
                });
            }
            return added;
        }, [] );

    var collapseThreads = query.get( 'collapseThreads' );
    var messageToThreadId = query.get( 'messageToThreadId' );
    var threadToMessageId = collapseThreads && added.length ?
            idList.reduce( function ( map, messageId ) {
                if ( messageId ) {
                    map[ messageToThreadId[ messageId ] ] = messageId;
                }
                return map;
            }, {} ) :
            {};

    added.sort( compareToMessage.bind( null, sort ) );

    return added.length ? added.reduce( function ( result, item ) {
        var messageId = item.messageId;
        var threadId = item.threadId;
        if ( !collapseThreads || !threadToMessageId[ threadId ] ) {
            threadToMessageId[ threadId ] = messageId;
            messageToThreadId[ messageId ] = threadId;
            result.push([ item.index + result.length, messageId ]);
        }
        return result;
    }, [] ) : null;
};

var updateQueries = function ( filterTest, sortTest, deltas ) {
    // Set as obsolete any message list that is filtered by
    // one of the removed or added mailboxes. If it's a simple query,
    // pre-emptively update it.
    var queries = store.getAllRemoteQueries();
    var l = queries.length;
    var query, filter, sort, delta;
    while ( l-- ) {
        query = queries[l];
        if ( query instanceof MessageList ) {
            filter = query.get( 'filter' );
            sort = query.get( 'sort' );
            if ( deltas && isFilteredJustOnMailbox( filter ) ) {
                delta = deltas[ filter.inMailboxes[0] ];
                if ( delta ) {
                    query.clientDidGenerateUpdate({
                        added: calculatePreemptiveAdd( query, delta.added ),
                        removed: delta.removed
                    });
                }
            } else if ( filterTest( filter ) || sortTest( sort ) ) {
                query.setObsolete();
            }
        }
    }
};

// ---

var identity = function ( v ) { return v; };

var addMoveInverse = function ( inverse, undoManager, willAdd, willRemove, messageId ) {
    var l = willRemove ? willRemove.length : 1;
    var i, addMailboxId, removeMailboxId, data;
    for ( i = 0; i < l; i += 1 ) {
        addMailboxId = willAdd ? willAdd[0].get( 'id' ) : '-';
        removeMailboxId = willRemove ? willRemove[i].get( 'id' ) : '-';
        data = inverse[ addMailboxId + removeMailboxId ];
        if ( !data ) {
            data = {
                method: 'move',
                messageIds: [],
                args: [
                    null,
                    willRemove && removeMailboxId,
                    willAdd && addMailboxId,
                    true
                ]
            };
            inverse[ addMailboxId + removeMailboxId ] = data;
            undoManager.pushUndoData( data );
        }
        data.messageIds.push( messageId );
        willAdd = null;
    }
};

// ---

var READY = O.Status.READY;

var NO = 0;
var TO_THREAD = 1;
var TO_MAILBOX = 2;

var getMessages = function getMessages ( ids, expand, mailbox, messageToThreadId, callback, hasDoneLoad ) {
    // Map to threads, then make sure all threads, including headers
    // are loaded
    var allLoaded = true,
        messages = [],
        inTrash;

    var checkMessage = function ( message ) {
        if ( message.is( READY ) ) {
            if ( expand === TO_MAILBOX && mailbox ) {
                if ( message.get( 'mailboxes' ).contains( mailbox ) ) {
                    messages.push( message );
                }
            } else if ( expand === TO_THREAD ) {
                if ( message.isIn( 'trash' ) === inTrash ) {
                    messages.push( message );
                }
            } else {
                messages.push( message );
            }
        } else {
            allLoaded = false;
        }
    };

    ids.forEach( function ( id ) {
        var message = store.getRecord( Message, id ),
            threadId = messageToThreadId[ id ],
            thread;
        inTrash = message.isIn( 'trash' );
        if ( expand && threadId ) {
            thread = store.getRecord( Thread, threadId );
            if ( thread.is( READY ) ) {
                thread.get( 'messages' ).forEach( checkMessage );
            } else {
                allLoaded = false;
            }
        } else {
            checkMessage( message );
        }
    });

    if ( allLoaded || hasDoneLoad ) {
        JMAP.mail.gc.isPaused = false;
        callback( messages );
    } else {
        // Suspend gc and wait for next API request: guaranteed to load
        // everything
        JMAP.mail.gc.isPaused = true;
        JMAP.mail.addCallback(
            getMessages.bind( null,
                ids, expand, mailbox, messageToThreadId, callback, true )
        );
    }
    return true;
};

// ---

var doUndoAction = function ( method, args ) {
    return function ( callback, messages ) {
        var mail = JMAP.mail;
        if ( messages ) {
            args[0] = messages;
        }
        mail[ method ].apply( mail, args );
        callback( null );
    };
};

// ---

var byFolderTreeOrder = function ( a, b ) {
    if ( a === b ) {
        return 0;
    }
    if ( a.get( 'parent' ) !== b.get( 'parent' ) ) {
        var aParents = [a],
            bParents = [b],
            parent = a,
            al, bl;

        while ( parent = parent.get( 'parent' ) ) {
            if ( parent === b ) {
                return 1;
            }
            aParents.push( parent );
        }
        parent = b;
        while ( parent = parent.get( 'parent' ) ) {
            if ( parent === a ) {
                return -1;
            }
            bParents.push( parent );
        }

        al = aParents.length;
        bl = bParents.length;
        while ( al-- && bl-- ) {
            if ( ( a = aParents[ al ] ) !== ( b = bParents[ bl ] ) ) {
                break;
            }
        }
    }
    return ( a.get( 'sortOrder' ) - b.get( 'sortOrder' ) ) ||
        O.i18n.compare( a.get( 'displayName' ), b.get( 'displayName' ) ) ||
        ( a.get( 'id' ) < b.get( 'id' ) ? -1 : 1 );
};

var rootMailboxes = store.getQuery( 'rootMailboxes', O.LiveQuery, {
    Type: Mailbox,
    filter: function ( data ) {
        return !data.parentId;
    },
    sort: [ 'sortOrder', 'name' ]
});

var allMailboxes = new O.ObservableArray( null, {
    content: store.getQuery( 'allMailboxes', O.LiveQuery, {
        Type: Mailbox
    }),
    contentDidChange: function () {
        var mailboxes = this.get( 'content' ).get( '[]' );
        mailboxes.sort( byFolderTreeOrder );
        return this.set( '[]', mailboxes );
    }
}).contentDidChange();
store.on( Mailbox, allMailboxes, 'contentDidChange' );

var systemMailboxIds = new O.Object({
    foldersDidChange: function () {
        rootMailboxes.forEach( function ( mailbox ) {
            var role = mailbox.get( 'role' );
            if ( role ) {
                this.set( role, mailbox.get( 'id' ) );
            }
            if ( mailbox.get( 'name' ) === 'Templates' ) {
                this.set( 'templates', mailbox.get( 'id' ) );
            }
        }, this );
    }
});
rootMailboxes.addObserverForKey( '[]', systemMailboxIds, 'foldersDidChange' );

// ---

O.extend( JMAP.mail, {

    getMessages: getMessages,

    gc: new O.MemoryManager( store, [
        {
            Type: Message,
            max: 1200
        },
        {
            Type: Thread,
            max: 1000
        },
        {
            Type: MessageList,
            max: 5,
            // This is really needed to check for disappearing Messages/Threads,
            // but more efficient to run it here.
            afterCleanup: function () {
                var queries = store.getAllRemoteQueries(),
                    l = queries.length,
                    query;
                while ( l-- ) {
                    query = queries[l];
                    if ( query instanceof MessageList ) {
                        query.recalculateFetchedWindows();
                    }
                }
            }
        }
    ], 60000 ),

    undoManager: new O.UndoManager({

        store: store,

        maxUndoCount: 10,

        pending: [],
        sequence: null,

        getUndoData: function () {
            var data = this.pending;
            if ( data.length ) {
                this.pending = [];
            } else {
                data = null;
            }
            return data;
        },

        pushUndoData: function ( data ) {
            this.pending.push( data );
            if ( !this.get( 'sequence' ) ) {
                this.dataDidChange();
            }
            return data;
        },

        applyChange: function ( data ) {
            var mail = JMAP.mail;
            var pending = this.pending;
            var sequence = new JMAP.Sequence();
            var l = data.length;
            var call, ids;

            while ( l-- ) {
                call = data[l];
                ids = call.messageIds;
                if ( ids ) {
                    sequence.then(
                        mail.getMessages.bind( null, ids, NO, null, {} ) );
                }
                sequence.then( doUndoAction( call.method, call.args ) );
            }

            sequence.afterwards = function () {
                this.set( 'sequence', null );
                if ( !pending.length ) {
                    var redoStack = this._redoStack;
                    if ( redoStack.last() === pending ) {
                        redoStack.pop();
                        this.set( 'canRedo', !!redoStack.length );
                    }
                }
                this.pending = [];
            }.bind( this );

            this.set( 'sequence', sequence );

            sequence.go( null );

            return pending;
        }
    }),

    // ---

    byFolderTreeOrder: byFolderTreeOrder,

    rootMailboxes: rootMailboxes,

    allMailboxes: allMailboxes,

    systemMailboxIds: systemMailboxIds,

    // ---

    setUnread: function ( messages, isUnread, allowUndo ) {
        var mailboxDeltas = {};
        var trashId = systemMailboxIds.get( 'trash' );
        var inverseMessageIds = allowUndo ? [] : null;
        var inverse = allowUndo ? {
                method: 'setUnread',
                messageIds: inverseMessageIds,
                args: [
                    null,
                    !isUnread,
                    true
                ]
            } : null;

        messages.forEach( function ( message ) {
            // Check we have something to do
            if ( message.get( 'isUnread' ) === isUnread ) {
                return;
            }

            // Get the thread and cache the current unread state
            var thread = message.get( 'thread' );
            var isInTrash = message.get( 'isInTrash' );
            var threadUnread =
                    thread &&
                    ( isInTrash ?
                        thread.get( 'isUnreadInTrash' ) :
                        thread.get( 'isUnread' ) ) ?
                    1 : 0;
            var mailboxCounts, mailboxId, mailbox, delta;

            // Update the message
            message.set( 'isUnread', isUnread );

            // Add inverse for undo
            if ( allowUndo ) {
                inverseMessageIds.push( message.get( 'id' ) );
            }

            // Draft messages unread status don't count in mailbox unread counts
            if ( message.get( 'isDraft' ) ) {
                return;
            }

            // Calculate any changes to the mailbox unread message counts
            if ( isInTrash ) {
                getMailboxDelta( mailboxDeltas, trashId )
                    .unreadMessages += isUnread ? 1 : -1;
            } else {
                message.get( 'mailboxes' ).forEach( function ( mailbox ) {
                    var mailboxId = mailbox.get( 'id' );
                    var delta = getMailboxDelta( mailboxDeltas, mailboxId );
                    delta.unreadMessages += isUnread ? 1 : -1;
                });
            }

            // See if the thread unread state has changed
            if ( thread ) {
                threadUnread = ( isInTrash ?
                    thread.get( 'isUnreadInTrash' ) :
                    thread.get( 'isUnread' )
                ) - threadUnread;
            }

            // Calculate any changes to the mailbox unread thread counts
            if ( threadUnread && isInTrash ) {
                getMailboxDelta( mailboxDeltas, trashId )
                    .unreadThreads += threadUnread;
            } else {
                mailboxCounts = thread.get( 'mailboxCounts' );
                for ( mailboxId in mailboxCounts ) {
                    if ( mailboxId !== trashId ) {
                        mailbox = store.getRecord( Mailbox, mailboxId );
                        delta = getMailboxDelta( mailboxDeltas, mailboxId );
                        delta.unreadThreads += threadUnread;
                    }
                }
            }
        });

        // Update counts on mailboxes
        updateMailboxCounts( mailboxDeltas );

        // Update message list queries, or mark in need of refresh
        updateQueries( isFilteredOnUnread, isSortedOnUnread, null );

        if ( allowUndo && inverseMessageIds.length ) {
            this.undoManager.pushUndoData( inverse );
        }

        return this;
    },

    setFlagged: function ( messages, isFlagged, allowUndo ) {
        var inverseMessageIds = allowUndo ? [] : null;
        var inverse = allowUndo ? {
                method: 'setFlagged',
                messageIds: inverseMessageIds,
                args: [
                    null,
                    !isFlagged,
                    true
                ]
            } : null;

        messages.forEach( function ( message ) {
            // Check we have something to do
            if ( message.get( 'isFlagged' ) === isFlagged ) {
                return;
            }

            // Update the message
            message.set( 'isFlagged', isFlagged );

            // Add inverse for undo
            if ( allowUndo ) {
                inverseMessageIds.push( message.get( 'id' ) );
            }
        });

        // Update message list queries, or mark in need of refresh
        updateQueries( isFilteredOnFlagged, isSortedOnFlagged, null );

        if ( allowUndo && inverseMessageIds.length ) {
            this.undoManager.pushUndoData( inverse );
        }

        return this;
    },

    move: function ( messages, addMailboxId, removeMailboxId, allowUndo ) {
        var mailboxDeltas = {};
        var inverse = allowUndo ? {} : null;
        var undoManager = this.undoManager;

        var addMailbox = addMailboxId ?
                store.getRecord( Mailbox, addMailboxId ) : null;
        var removeMailbox = removeMailboxId ?
                store.getRecord( Mailbox, removeMailboxId ) : null;
        var isToTrash = addMailbox ?
                addMailbox.get( 'role' ) === 'trash' : false;
        var isFromTrash = removeMailbox ?
                removeMailbox.get( 'role' ) === 'trash' : false;

        // TODO: Check mailboxes still exist? Could in theory have been deleted.

        // Check we're not moving from/to the same place
        if ( addMailbox === removeMailbox ) {
            return;
        }

        // Check ACLs
        if ( addMailbox && ( !addMailbox.is( READY ) ||
                !addMailbox.get( 'mayAddItems' ) ) ) {
            O.RunLoop.didError({
                name: 'JMAP.mail.move',
                message: 'May not add messages to ' + addMailbox.get( 'name' )
            });
            return this;
        }
        if ( removeMailbox && ( !removeMailbox.is( READY ) ||
                !removeMailbox.get( 'mayRemoveItems' ) ) ) {
            O.RunLoop.didError({
                name: 'JMAP.mail.move',
                message: 'May not remove messages from ' +
                    removeMailbox.get( 'name' )
            });
            return this;
        }

        messages.forEach( function ( message ) {
            var messageId = message.get( 'id' );
            var mailboxes = message.get( 'mailboxes' );

            // Calculate the set of mailboxes to add/remove
            var willAdd = addMailbox && [ addMailbox ];
            var willRemove = null;
            var mailboxToRemoveIndex = -1;

            var wasThreadUnread = false;
            var wasThreadUnreadInTrash = false;
            var isThreadUnread = false;
            var isThreadUnreadInTrash = false;
            var mailboxCounts = null;

            var isUnread, thread;
            var deltaThreadUnread, deltaThreadUnreadInTrash;
            var decrementMailboxCount, incrementMailboxCount;
            var delta, mailboxId, mailbox;

            // Calculate the changes required to the message's mailboxes
            mailboxes.forEach( function ( mailbox, index ) {
                if ( mailbox === addMailbox ) {
                    willAdd = null;
                }
                if ( mailbox === removeMailbox ) {
                    willRemove = [ mailbox ];
                    mailboxToRemoveIndex = index;
                }
            });
            if ( willAdd && addMailbox.get( 'mustBeOnlyMailbox' ) ) {
                willRemove = mailboxes.map( identity );
                mailboxToRemoveIndex = 0;
            }

            // Check we have something to do
            if ( !willRemove && !willAdd ) {
                return;
            }

            // Get the thread and cache the current unread state
            isUnread = message.get( 'isUnread' ) && !message.get( 'isDraft' );
            thread = message.get( 'thread' );
            if ( thread ) {
                wasThreadUnread = thread.get( 'isUnread' );
                wasThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );
            }

            // Update the message
            mailboxes.replaceObjectsAt(
                willRemove ? mailboxToRemoveIndex : mailboxes.get( 'length' ),
                willRemove ? willRemove.length : 0,
                willAdd
            );
            // FastMail specific
            if ( willRemove ) {
                message.set( 'previousFolderId', willRemove[0].get( 'id' ) );
            }
            // end

            // Add inverse for undo
            if ( allowUndo ) {
                addMoveInverse( inverse, undoManager,
                    willAdd, willRemove, messageId );
            }

            // Calculate any changes to the mailbox message counts
            if ( thread ) {
                isThreadUnread = thread.get( 'isUnread' );
                isThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );
                mailboxCounts = thread.get( 'mailboxCounts' );
            }

            decrementMailboxCount = function ( mailbox ) {
                var delta = getMailboxDelta(
                        mailboxDeltas, mailbox.get( 'id' ) );
                delta.removed.push( messageId );
                delta.totalMessages -= 1;
                if ( isUnread ) {
                    delta.unreadMessages -= 1;
                }
                // If this was the last message in the thread in the mailbox
                if ( thread && !mailboxCounts[ mailboxId ] ) {
                    delta.totalThreads -= 1;
                    if ( mailbox.get( 'role' ) === 'trash' ?
                            wasThreadUnreadInTrash : wasThreadUnread ) {
                        delta.unreadThreads -= 1;
                    }
                }
            };
            incrementMailboxCount = function ( mailbox ) {
                var delta = getMailboxDelta(
                        mailboxDeltas, mailbox.get( 'id' ) );
                delta.added.push( message );
                delta.totalMessages += 1;
                if ( isUnread ) {
                    delta.unreadMessages += 1;
                }
                // If this was the first message in the thread in the
                // mailbox
                if ( thread && mailboxCounts[ mailboxId ] === 1 ) {
                    delta.totalThreads += 1;
                    if ( mailbox.get( 'role' ) === 'trash' ?
                            isThreadUnreadInTrash : isThreadUnread ) {
                        delta.unreadThreads += 1;
                    }
                }
            };

            if ( willRemove ) {
                willRemove.forEach( decrementMailboxCount );
            }

            // If moved to Trash, we have essentially removed from all other
            // mailboxes, even if they are still present.
            if ( isToTrash && willAdd && mailboxes.get( 'length' ) > 1 ) {
                mailboxes.forEach( function ( mailbox ) {
                    if ( mailbox !== addMailbox ) {
                        decrementMailboxCount( mailbox );
                    }
                });
            }

            // If moved from trash, all mailboxes are essentially added
            // for counts/message list purposes
            if ( isFromTrash && willRemove ) {
                mailboxes.forEach( incrementMailboxCount );
            } else if ( willAdd ) {
                incrementMailboxCount( addMailbox );
            }

            // If the thread unread state has changed (due to moving in/out of
            // trash), we might need to update mailboxes that the messages is
            // not in now and wasn't in before!
            // We need to adjust the count for any mailbox that hasn't already
            // been updated above. This means it must either:
            // 1. Have more than 1 message in the thread in it; or
            // 2. Not have been in the set of mailboxes we just added to this
            //    message
            deltaThreadUnread =
                ( isThreadUnread ? 1 : 0 ) -
                ( wasThreadUnread ? 1 : 0 );
            deltaThreadUnreadInTrash =
                ( isThreadUnreadInTrash ? 1 : 0 ) -
                ( wasThreadUnreadInTrash ? 1 : 0 );

            if ( deltaThreadUnread || deltaThreadUnreadInTrash ) {
                // If from trash, we've essentially added it to all the
                // mailboxes it's currently in for counts purposes
                if ( isFromTrash && willRemove ) {
                    willAdd = mailboxes;
                }
                for ( mailboxId in mailboxCounts ) {
                    mailbox = store.getRecord( Mailbox, mailboxId );
                    if ( mailboxCounts[ mailboxId ] > 1 ||
                            !willAdd.contains( mailbox ) ) {
                        delta = getMailboxDelta( mailboxDeltas, mailboxId );
                        if ( mailbox.get( 'role' ) === 'trash' ) {
                            delta.unreadThreads += deltaThreadUnreadInTrash;
                        } else {
                            delta.unreadThreads += deltaThreadUnread;
                        }
                    }
                }
            }
        });

        // Update counts on mailboxes
        updateMailboxCounts( mailboxDeltas );

        // Update message list queries, or mark in need of refresh
        updateQueries( isFilteredOnMailboxes, isFalse, mailboxDeltas );

        return this;
    },

    destroy: function ( messages ) {
        var mailboxDeltas = {};

        messages.forEach( function ( message ) {
            var mailboxes = message.get( 'mailboxes' );

            var wasThreadUnread = false;
            var wasThreadUnreadInTrash = false;
            var isThreadUnread = false;
            var isThreadUnreadInTrash = false;
            var mailboxCounts = null;

            var isUnread, thread;
            var deltaThreadUnread, deltaThreadUnreadInTrash;
            var delta, mailboxId, mailbox, messageWasInMailbox, countInMailbox;

            // Get the thread and cache the current unread state
            isUnread = message.get( 'isUnread' ) && !message.get( 'isDraft' );
            thread = message.get( 'thread' );
            if ( thread ) {
                mailboxCounts = thread.get( 'mailboxCounts' );
                wasThreadUnread = thread.get( 'isUnread' );
                wasThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );
            }

            // Update the message
            message.destroy();

            if ( thread ) {
                // Preemptively update the thread
                thread.get( 'messages' ).remove( message );
                thread.refresh();

                // Calculate any changes to the mailbox message counts
                isThreadUnread = thread.get( 'isUnread' );
                isThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );

                deltaThreadUnread =
                    ( isThreadUnread ? 1 : 0 ) -
                    ( wasThreadUnread ? 1 : 0 );
                deltaThreadUnreadInTrash =
                    ( isThreadUnreadInTrash ? 1 : 0 ) -
                    ( wasThreadUnreadInTrash ? 1 : 0 );

                for ( mailboxId in mailboxCounts ) {
                    mailbox = store.getRecord( Mailbox, mailboxId );
                    messageWasInMailbox = mailboxes.contains( mailbox );
                    countInMailbox = mailboxCounts[ mailboxId ];
                    if ( messageWasInMailbox ) {
                        delta = getMailboxDelta( mailboxDeltas, mailboxId );
                        delta.totalMessages -= 1;
                        if ( isUnread ) {
                            delta.unreadMessages -= 1;
                        }
                    }
                    if ( deltaThreadUnread || deltaThreadUnreadInTrash ) {
                        delta = getMailboxDelta( mailboxDeltas, mailboxId );
                        if ( mailbox.get( 'role' ) === 'trash' ) {
                            delta.unreadThreads += deltaThreadUnreadInTrash;
                        } else {
                            delta.unreadThreads += deltaThreadUnread;
                        }
                    }
                }
            } else {
                mailboxes.forEach( function ( mailbox ) {
                    var delta = getMailboxDelta(
                            mailboxDeltas, mailbox.get( 'id' ) );
                    delta.totalMessages -= 1;
                    if ( isUnread ) {
                        delta.unreadMessages -= 1;
                    }
                });
            }
        });

        // Update counts on mailboxes
        updateMailboxCounts( mailboxDeltas );

        // Update message list queries, or mark in need of refresh
        updateQueries( isTrue, isFalse, mailboxDeltas );

        return this;
    },

    report: function ( messages, asSpam, allowUndo ) {
        var messageIds = messages.map( function ( message ) {
            return message.get( 'id' );
        });

        this.callMethod( 'reportMessages', {
            messageIds: messageIds,
            asSpam: asSpam
        });

        if ( allowUndo ) {
            this.undoManager.pushUndoData({
                method: 'reportMessages',
                messageIds: messageIds,
                args: [
                    null,
                    !asSpam,
                    true
                ]
            });
        }

        return this;
    },

    // ---

    saveDraft: function ( message ) {
        var inReplyToMessageId = message.get( 'inReplyToMessageId' ),
            inReplyToMessage = null,
            thread = null,
            messages = null,
            isFirstDraft = true,
            READY = O.Status.READY;
        if ( inReplyToMessageId &&
                ( store.getRecordStatus(
                    Message, inReplyToMessageId ) & READY ) ) {
            inReplyToMessage = store.getRecord( Message, inReplyToMessageId );
            thread = inReplyToMessage.get( 'thread' );
            if ( thread && thread.is( READY ) ) {
                messages = thread.get( 'messages' );
            }
        }

        // Save message
        message.get( 'mailboxes' ).add(
            store.getRecord( Mailbox, systemMailboxIds.get( 'drafts' ) )
        );
        message.saveToStore();

        // Pre-emptively update thread
        if ( messages ) {
            isFirstDraft = !messages.some( function ( message ) {
                return message.isIn( 'drafts' );
            });
            messages.replaceObjectsAt(
                messages.indexOf( inReplyToMessage ) + 1, 0, [ message ] );
            thread.refresh();
        }

        // Pre-emptively update draft mailbox counts
        store.getRecord( Mailbox, systemMailboxIds.get( 'drafts' ) )
            .increment( 'totalMessages', 1 )
            .increment( 'totalThreads', isFirstDraft ? 1 : 0 )
            .setObsolete()
            .refresh();

        return this;
    }
});

}( JMAP ) );
