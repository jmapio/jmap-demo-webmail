"use strict";

// -------------------------------------------------------------------------- \\
// File: DateJSON.js                                                          \\
// Module: API                                                                \\
// -------------------------------------------------------------------------- \\

'use strict';

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

Date.toUTCJSON = function ( date ) {
    return date.toJSON() + 'Z';
};


// -------------------------------------------------------------------------- \\
// File: namespace.js                                                         \\
// Module: API                                                                \\
// -------------------------------------------------------------------------- \\

'use strict';

this.JMAP = {};


// -------------------------------------------------------------------------- \\
// File: Auth.js                                                              \\
// Module: API                                                                \\
// Requires: namespace.js                                                     \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const auth = new O.Object({

    isAuthenticated: false,

    username: '',

    accounts: {},
    capabilities: {
        'ietf:jmap': {
            maxSizeUpload: 50000000,
            maxConcurrentUpload: 10,
            maxSizeRequest: 5000000,
            maxConcurrentRequests: 8,
            maxCallsInRequest: 32,
            maxObjectsInGet: 1024,
            maxObjectsInSet: 1024,
            collationAlgorithms: [
                'i;ascii-numeric',
                'i;ascii-casemap',
            ],
        },
    },

    authenticationUrl: '',
    apiUrl: '',
    downloadUrl: '',
    uploadUrl: '',
    eventSourceUrl: '',

    defaultAccountId: function () {
        var accounts = this.get( 'accounts' );
        var id;
        for ( id in accounts ) {
            if ( accounts[ id ].isPrimary ) {
                return id;
            }
        }
        return null;
    }.property( 'accounts' ),

    // ---

    didAuthenticate: function ( data ) {
        for ( var property in data ) {
            if ( typeof this[ property ] !== 'function' ) {
                this.set( property, data[ property ] );
            }
        }
        this.set( 'isAuthenticated', true );

        this._awaitingAuthentication.forEach( function ( connection ) {
            connection.send();
        });
        this._awaitingAuthentication.length = 0;

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
        if ( !isAuthenticated || this._isFetchingSession ) {
            this._awaitingAuthentication.include( connection );
        }
        return false;
    },

    connectionSucceeded: function () {
        if ( this.get( 'isDisconnected' ) ) {
            this._timeToWait = 1;
            this.set( 'isDisconnected', false );
        }
    },

    connectionFailed: function ( connection, timeToWait ) {
        if ( this.get( 'isAuthenticated' ) ) {
            this._failedConnections.include( connection );
            this.retryIn( timeToWait );
        } else {
            this._awaitingAuthentication.include( connection );
        }
    },

    retryIn: function ( timeToWait ) {
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

// --- Export

JMAP.auth = auth;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Connection.js                                                        \\
// Module: API                                                                \\
// Requires: Auth.js                                                          \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP, JSON, console, alert */

'use strict';

( function ( JMAP, undefined ) {

const isEqual = O.isEqual;
const loc = O.loc;
const guid = O.guid;
const Class = O.Class;
const RunLoop = O.RunLoop;
const HttpRequest = O.HttpRequest;
const Source = O.Source;

const auth = JMAP.auth;

// ---

const makePatches = function ( path, patches, original, current ) {
    var key;
    var didPatch = false;
    if ( original && current &&
            typeof current === 'object' && !( current instanceof Array ) ) {
        for ( key in current ) {
            didPatch = makePatches(
                path + '/' + key.replace( /~/g, '~0' ).replace( /\//g, '~1' ),
                patches,
                original[ key ],
                current[ key ]
            ) || didPatch;
        }
        for ( key in original ) {
            if ( !( key in current ) ) {
                didPatch = makePatches(
                    path + '/' +
                        key.replace( /~/g, '~0' ).replace( /\//g, '~1' ),
                    patches,
                    original[ key ],
                    null
                ) || didPatch;
            }
        }
    } else if ( !isEqual( original, current ) ) {
        patches[ path ] = current !== undefined ? current : null;
        didPatch = true;
    }
    return didPatch;
};

const makeUpdate = function ( primaryKey, update, includeId ) {
    const records = update.records;
    const changes = update.changes;
    const committed = update.committed;
    const updates = {};
    var record, change, previous, patches, i, l, key;
    for ( i = 0, l = records.length; i < l; i +=1 ) {
        record = records[i];
        change = changes[i];
        previous = committed[i];
        patches = {};

        for ( key in change ) {
            if ( change[ key ] && key !== 'accountId' ) {
                makePatches( key, patches, previous[ key ], record[ key ] );
            }
        }
        if ( includeId ) {
            patches[ primaryKey ] = record[ primaryKey ];
        }

        updates[ record[ primaryKey ] ] = patches;
    }
    return Object.keys( updates ).length ? updates : undefined;
};

const makeSetRequest = function ( change ) {
    var create = change.create;
    var update = change.update;
    var destroy = change.destroy;
    var toCreate = create.storeKeys.length ?
        Object.zip( create.storeKeys, create.records ) :
        undefined;
    var toUpdate = makeUpdate( change.primaryKey, update, false );
    var toDestroy = destroy.ids.length ?
        destroy.ids :
        undefined;
    return toCreate || toUpdate || toDestroy ? {
        accountId: change.accountId,
        create: toCreate,
        update: toUpdate,
        destroy: toDestroy,
    } : null;
};

const handleProps = {
    precedence: 'commitPrecedence',
    fetch: 'recordFetchers',
    refresh: 'recordRefreshers',
    commit: 'recordCommitters',
    query: 'queryFetchers',
};

/**
    Class: JMAP.Connection

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
    <JMAP.Connection#response> available to the server to call.
*/
const Connection = Class({

    Extends: Source,

    /**
        Constructor: JMAP.Connection

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

        // Map of id -> O.Query for all queries to be fetched.
        this._queriesToFetch = {};
        // Map of accountId -> guid( Type ) -> state
        this._typesToRefresh = {};
        // Map of accountId -> guid( Type ) -> Id -> true
        this._recordsToRefresh = {};
        // Map of accountId -> guid( Type ) -> null
        this._typesToFetch = {};
        // Map of accountId -> guid( Type ) -> Id -> true
        this._recordsToFetch = {};

        this.inFlightRemoteCalls = null;
        this.inFlightCallbacks = null;
        this.inFlightRequest = null;

        Connection.parent.constructor.call( this, mixin );
    },

    prettyPrint: false,

    /**
        Property: JMAP.Connection#willRetry
        Type: Boolean

        If true, retry the request if the connection fails or times out.
    */
    willRetry: true,

    /**
        Property: JMAP.Connection#timeout
        Type: Number

        Time in milliseconds at which to time out the request. Set to 0 for no
        timeout.
    */
    timeout: 30000,

    /**
        Property: JMAP.Connection#inFlightRequest
        Type: (O.HttpRequest|null)

        The HttpRequest currently in flight.
    */
    inFlightRequest: null,

    /**
        Method: JMAP.Connection#ioDidSucceed

        Callback when the IO succeeds. Parses the JSON and passes it on to
        <JMAP.Connection#receive>.

        Parameters:
            event - {IOEvent}
    */
    ioDidSucceed: function ( event ) {
        var methodResponses = event.data && event.data.methodResponses;
        if ( !methodResponses ) {
            RunLoop.didError({
                name: 'JMAP.Connection#ioDidSucceed',
                message: 'No method responses received.',
                details: 'Request:\n' +
                    JSON.stringify( this.get( 'inFlightRemoteCalls' ), null, 2 )
            });
            methodResponses = [];
        }

        auth.connectionSucceeded( this );

        this.receive(
            methodResponses,
            this.get( 'inFlightCallbacks' ),
            this.get( 'inFlightRemoteCalls' )
        );

        this.set( 'inFlightRemoteCalls', null )
            .set( 'inFlightCallbacks', null );
    }.on( 'io:success' ),

    /**
        Method: JMAP.Connection#ioDidFail

        Callback when the IO fails.

        Parameters:
            event - {IOEvent}
    */
    ioDidFail: function ( event ) {
        var discardRequest = false;
        var status = event.status;

        switch ( status ) {
        // 400: Bad Request
        // 413: Payload Too Large
        case 400:
        case 413:
            var response = event.data;
            RunLoop.didError({
                name: 'JMAP.Connection#ioDidFail',
                message: 'Bad request made: ' + status,
                details: 'Request was:\n' +
                    JSON.stringify(
                        this.get( 'inFlightRemoteCalls' ), null, 2 ) +
                    '\n\nResponse was:\n' +
                    ( response ? JSON.stringify( response, null, 2 ) :
                        '(no data, the response probably wasn’t valid JSON)' ),
            });
            discardRequest = true;
            break;
        // 401: Unauthorized
        case 401:
            auth.didLoseAuthentication()
                .connectionWillSend( this );
            break;
        // 404: Not Found
        case 404:
            auth.fetchSessions()
                .connectionWillSend( this );
            break;
        // 429: Rate Limited
        // 503: Service Unavailable
        // Wait a bit then try again
        case 429:
        case 503:
            auth.connectionFailed( this, 30 );
            break;
        // 500: Internal Server Error
        case 500:
            alert( loc( 'FEEDBACK_SERVER_FAILED' ) );
            discardRequest = true;
            break;
        // Presume a connection error. Try again if willRetry is set,
        // otherwise discard.
        default:
            if ( this.get( 'willRetry' ) ) {
                auth.connectionFailed( this );
            } else {
                discardRequest = true;
            }
        }

        if ( discardRequest ) {
            this.receive(
                [],
                this.get( 'inFlightCallbacks' ),
                this.get( 'inFlightRemoteCalls' )
            );

            this.set( 'inFlightRemoteCalls', null )
                .set( 'inFlightCallbacks', null );
        }
    }.on( 'io:failure', 'io:abort' ),

    /**
        Method: JMAP.Connection#ioDidEnd

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
        Method: JMAP.Connection#callMethod

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

    getPreviousMethodId: function () {
        return ( this._sendQueue.length - 1 ) + '';
    },

    addCallback: function ( callback ) {
        this._callbackQueue.push([ '', callback ]);
        return this;
    },

    hasRequests: function () {
        var id;
        if ( this.get( 'inFlightRemoteCalls' ) || this._sendQueue.length ) {
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
            'Authorization': 'Bearer ' + auth.get( 'accessToken' )
        };
    }.property().nocache(),

    /**
        Method: JMAP.Connection#send

        Send any queued method calls at the end of the current run loop.
    */
    send: function () {
        if ( this.get( 'inFlightRequest' ) ||
                !auth.connectionWillSend( this ) ) {
            return;
        }

        var remoteCalls = this.get( 'inFlightRemoteCalls' );
        var request;
        if ( !remoteCalls ) {
            request = this.makeRequest();
            remoteCalls = request[0];
            if ( !remoteCalls.length ) { return; }
            this.set( 'inFlightRemoteCalls', remoteCalls );
            this.set( 'inFlightCallbacks', request[1] );
        }

        this.set( 'inFlightRequest',
            new HttpRequest({
                nextEventTarget: this,
                timeout: this.get( 'timeout' ),
                method: 'POST',
                url: auth.get( 'apiUrl' ),
                headers: this.get( 'headers' ),
                withCredentials: true,
                responseType: 'json',
                data: JSON.stringify({
                    using: [
                        'ietf:jmap',
                        'ietf:jmapmail',
                    ],
                    methodCalls: remoteCalls,
                }, null, this.get( 'prettyPrint' ) ? 2 : 0 ),
            }).send()
        );
    }.queue( 'after' ),

    /**
        Method: JMAP.Connection#receive

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
        var handlers = this.response;
        var i, l, response, handler, tuple, id, callback, request;
        for ( i = 0, l = data.length; i < l; i += 1 ) {
            response = data[i];
            handler = handlers[ response[0] ];
            if ( handler ) {
                id = response[2];
                request = remoteCalls[+id];
                try {
                    handler.call( this, response[1], request[0], request[1] );
                } catch ( error ) {
                    RunLoop.didError( error );
                }
            }
        }
        // Invoke after bindings to ensure all data has propagated through.
        if (( l = callbacks.length )) {
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
                RunLoop.queueFn( 'middle', callback );
            }
        }
    },

    /**
        Method: JMAP.Connection#makeRequest

        This will make calls to JMAP.Connection#(record|query)(Fetchers|Refreshers)
        to add any final API calls to the send queue, then return a tuple of the
        queue of method calls and the list of callbacks.

        Returns:
            {Array} Tuple of method calls and callbacks.
    */
    makeRequest: function () {
        var sendQueue = this._sendQueue;
        var callbacks = this._callbackQueue;
        var recordRefreshers = this.recordRefreshers;
        var recordFetchers = this.recordFetchers;
        var _queriesToFetch = this._queriesToFetch;
        var _typesToRefresh = this._typesToRefresh;
        var _recordsToRefresh = this._recordsToRefresh;
        var _typesToFetch = this._typesToFetch;
        var _recordsToFetch = this._recordsToFetch;
        var typesToRefresh, recordsToRefresh, typesToFetch, recordsToFetch;
        var accountId, typeId, id, req, state, ids, handler;

        // Query Fetches
        for ( id in _queriesToFetch ) {
            req = _queriesToFetch[ id ];
            handler = this.queryFetchers[ guid( req.constructor ) ];
            if ( handler ) {
                handler.call( this, req );
            }
        }

        // Record Refreshers
        for ( accountId in _typesToRefresh ) {
            typesToRefresh = _typesToRefresh[ accountId ];
            if ( !accountId ) {
                accountId = undefined;
            }
            for ( typeId in typesToRefresh ) {
                state = typesToRefresh[ typeId ];
                handler = recordRefreshers[ typeId ];
                if ( typeof handler === 'string' ) {
                    this.callMethod( handler, {
                        accountId: accountId,
                        sinceState: state,
                    });
                } else {
                    handler.call( this, accountId, null, state );
                }
            }
        }
        for ( accountId in _recordsToRefresh ) {
            recordsToRefresh = _recordsToRefresh[ accountId ];
            if ( !accountId ) {
                accountId = undefined;
            }
            for ( typeId in recordsToRefresh ) {
                handler = recordRefreshers[ typeId ];
                ids = Object.keys( recordsToRefresh[ typeId ] );
                if ( typeof handler === 'string' ) {
                    this.callMethod( handler, {
                        accountId: accountId,
                        ids: ids,
                    });
                } else {
                    recordRefreshers[ typeId ].call( this, accountId, ids );
                }
            }
        }

        // Record fetches
        for ( accountId in _typesToFetch ) {
            typesToFetch = _typesToFetch[ accountId ];
            if ( !accountId ) {
                accountId = undefined;
            }
            for ( typeId in typesToFetch ) {
                handler = recordFetchers[ typeId ];
                if ( typeof handler === 'string' ) {
                    this.callMethod( handler, {
                        accountId: accountId,
                    });
                } else {
                    handler.call( this, accountId, null );
                }
            }
        }
        for ( accountId in _recordsToFetch ) {
            recordsToFetch = _recordsToFetch[ accountId ];
            if ( !accountId ) {
                accountId = undefined;
            }
            for ( typeId in recordsToFetch ) {
                handler = recordFetchers[ typeId ];
                ids = Object.keys( recordsToFetch[ typeId ] );
                if ( typeof handler === 'string' ) {
                    this.callMethod( handler, {
                        accountId: accountId,
                        ids: ids,
                    });
                } else {
                    recordFetchers[ typeId ].call( this, accountId, ids );
                }
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
        Method: JMAP.Connection#fetchRecord

        Fetches a particular record from the source. Just passes the call on to
        <JMAP.Connection#_fetchRecords>.

        Parameters:
            Type     - {O.Class} The record type.
            id       - {String} The record id.
            callback - {Function} (optional) A callback to make after the record
                       fetch completes (successfully or unsuccessfully).

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchRecord: function ( accountId, Type, id, callback ) {
        return this._fetchRecords(
            accountId, Type, [ id ], callback, '', false );
    },

    /**
        Method: JMAP.Connection#fetchAllRecords

        Fetches all records of a particular type from the source. Just passes
        the call on to <JMAP.Connection#_fetchRecords>.

        Parameters:
            Type     - {O.Class} The record type.
            state    - {(String|undefined)} The state to update from.
            callback - {Function} (optional) A callback to make after the fetch
                       completes.

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchAllRecords: function ( accountId, Type, state, callback ) {
        return this._fetchRecords(
            accountId, Type, null, callback, state || '', !!state );
    },

    /**
        Method: JMAP.Connection#refreshRecord

        Fetches any new data for a record since the last fetch if a handler for
        the type is defined in <JMAP.Connection#recordRefreshers>, or refetches the
        whole record if not.

        Parameters:
            Type     - {O.Class} The record type.
            id       - {String} The record id.
            callback - {Function} (optional) A callback to make after the record
                       refresh completes (successfully or unsuccessfully).

        Returns:
            {Boolean} Returns true if the source handled the refresh.
    */
    refreshRecord: function ( accountId, Type, id, callback ) {
        return this._fetchRecords(
            accountId, Type, [ id ], callback, '', true );
    },

    _fetchRecords: function ( accountId, Type, ids, callback, state, refresh ) {
        var typeId = guid( Type );
        var handler = refresh ?
                this.recordRefreshers[ typeId ] :
                this.recordFetchers[ typeId ];
        if ( refresh && !handler ) {
            refresh = false;
            handler = this.recordFetchers[ typeId ];
        }
        if ( !handler ) {
            return false;
        }
        if ( ids ) {
            var reqs = refresh ? this._recordsToRefresh : this._recordsToFetch;
            var account = reqs[ accountId ] || ( reqs[ accountId ] = {} );
            var set = account[ typeId ] || ( account[ typeId ] = {} );
            var l = ids.length;
            while ( l-- ) {
                set[ ids[l] ] = true;
            }
        } else if ( refresh ) {
            var typesToRefresh = this._typesToRefresh[ accountId ] ||
                ( this._typesToRefresh[ accountId ] = {} );
            typesToRefresh[ typeId ] = state;
        } else {
            var typesToFetch = this._typesToFetch[ accountId ] ||
                ( this._typesToFetch[ accountId ] = {} );
            typesToFetch[ typeId ] = null;
        }
        if ( callback ) {
            this._callbackQueue.push([ '', callback ]);
        }
        this.send();
        return true;
    },

    /**
        Property: JMAP.Connection#commitPrecedence
        Type: String[Number]|null
        Default: null

        This is on optional mapping of type guids to a number indicating the
        order in which they are to be committed. Types with lower numbers will
        be committed first.
    */
    commitPrecedence: null,

    /**
        Method: JMAP.Connection#commitChanges

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
                id: {
                    Type: Record,
                    typeId: 'Record',
                    accountId: '...',
                    primaryKey: 'id',
                    create: {
                        storeKeys: [ 'sk1', 'sk2' ],
                        records: [{ attr: val, attr2: val2 ...}, {...}],
                    },
                    update: {
                        storeKeys: [ 'sk3', 'sk4', ... ],
                        records:   [{ id: 'id3', attr: val2 ... }, {...}],
                        committed:  [{ id: 'id3', attr: val1 ... }, {...}],
                        changes:   [{ attr: true }, ... ],
                    },
                    moveFromAccount: { ... previous account id -> update ... },
                    destroy: {
                        storeKeys: [ 'sk5', 'sk6' ],
                        ids: [ 'id5', 'id6' ],
                    },
                    state: 'i425m515233',
                },
                id2: {
                    ...
                },
            });

        Any types that are handled by the source are removed from the changes
        object (`delete changes[ typeId ]`); any unhandled types are left
        behind, so the object may be passed to several sources, with each
        handling their own types.

        In a JMAP source, this method considers each type in the changes.
        If that type has a handler defined in
        <JMAP.Connection#recordCommitters>, then this will be called with the
        create/update/destroy object as the sole argument.

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
        var ids = Object.keys( changes );
        var l = ids.length;
        var precedence = this.commitPrecedence;
        var handledAny = false;
        var handler, wasHandled, change, id;
        var setRequest, moveFromAccount, fromAccountId, toAccountId;

        if ( precedence ) {
            ids.sort( function ( a, b ) {
                return ( precedence[ changes[b].typeId ] || -1 ) -
                    ( precedence[ changes[a].typeId ] || -1 );
            });
        }

        while ( l-- ) {
            id = ids[l];
            change = changes[ id ];
            handler = this.recordCommitters[ change.typeId ];
            wasHandled = false;
            if ( handler ) {
                if ( typeof handler === 'string' ) {
                    setRequest = makeSetRequest( change );
                    if ( setRequest ) {
                        this.callMethod( handler, setRequest );
                    }
                    if (( moveFromAccount = change.moveFromAccount )) {
                        toAccountId = change.accountId;
                        for ( fromAccountId in moveFromAccount ) {
                            this.callMethod( change.typeId + '/copy', {
                                fromAccountId: fromAccountId,
                                toAccountId: toAccountId,
                                create: makeUpdate(
                                    change.primaryKey,
                                    moveFromAccount[ fromAccountId ],
                                    true
                                ),
                                onSuccessDestroyOriginal: true,
                            });
                        }
                    }
                } else {
                    handler.call( this, change );
                }
                wasHandled = true;
            }
            if ( wasHandled ) {
                delete changes[ id ];
            }
            handledAny = handledAny || wasHandled;
        }
        if ( handledAny && callback ) {
            this._callbackQueue.push([ '', callback ]);
        }
        return handledAny;
    },

    /**
        Method: JMAP.Connection#fetchQuery

        Fetches the data for a remote query from the source.

        Parameters:
            query - {O.Query} The query to fetch.

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchQuery: function ( query, callback ) {
        if ( !this.queryFetchers[ guid( query.constructor ) ] ) {
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
        Method: JMAP.Connection#handle

        Helper method to register handlers for a particular type. The handler
        object may include methods with the following keys:

        - precedence: Add function to `commitPrecedence` handlers.
        - fetch: Add function to `recordFetchers` handlers.
        - refresh: Add function to `recordRefreshers` handlers.
        - commit: Add function to `recordCommitters` handlers.
        - query: Add function to `queryFetcher` handlers.

        Any other keys are presumed to be a response method name, and added
        to the `response object.

        Parameters:
            Type     - {O.Class} The type these handlers are for.
            handlers - {string[function]} The handlers. These are registered
                       as described above.

        Returns:
            {JMAP.Connection} Returns self.
    */
    handle: function ( Type, handlers ) {
        var typeId = guid( Type );
        var action, propName, isResponse, actionHandlers;
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
        if ( Type ) {
            Type.source = this;
        }
        return this;
    },

    /**
        Property: JMAP.Connection#recordFetchers
        Type: String[Function]

        A map of type guids to functions which will fetch records of that type.
        The functions will be called with the source as 'this' and a list of ids
        or an object (passed straight through from your program) as the sole
        argument.
    */
    recordFetchers: {},

    /**
        Property: JMAP.Connection#recordRefreshers
        Type: String[Function]

        A map of type guids to functions which will refresh records of that
        type. The functions will be called with the source as 'this' and a list
        of ids or an object (passed straight through from your program) as the
        sole argument.
    */
    recordRefreshers: {},

    /**
        Property: JMAP.Connection#recordCommitters
        Type: String[Function]

        A map of type guids to functions which will commit all creates, updates
        and destroys requested for a particular record type.
    */
    recordCommitters: {},

    /**
        Property: JMAP.Connection#queryFetchers
        Type: String[Function]

        A map of query type guids to functions which will fetch the requested
        contents of that query. The function will be called with the source as
        'this' and the query as the sole argument.
    */
    queryFetchers: {},

    didFetch: function ( Type, args, isAll ) {
        var store = this.get( 'store' );
        var list = args.list;
        var state = args.state;
        var notFound = args.notFound;
        var accountId = args.accountId;
        if ( list ) {
            store.sourceDidFetchRecords( accountId, Type, list, state, isAll );
        }
        if ( notFound ) {
            store.sourceCouldNotFindRecords( accountId, Type, notFound );
        }
    },

    didFetchUpdates: function ( Type, args, hasDataForChanged ) {
        this.get( 'store' )
            .sourceDidFetchUpdates(
                args.accountId,
                Type,
                hasDataForChanged ? null : args.changed || null,
                args.destroyed || null,
                args.oldState,
                args.newState
            );
    },

    didCommit: function ( Type, args ) {
        var store = this.get( 'store' );
        var accountId = args.accountId;
        var toStoreKey = store.getStoreKey.bind( store, accountId, Type );
        var list, object;

        if ( ( object = args.created ) && Object.keys( object ).length ) {
            store.sourceDidCommitCreate( object );
        }
        if ( ( object = args.notCreated ) ) {
            list = Object.keys( object );
            if ( list.length ) {
                store.sourceDidNotCreate( list, true, Object.values( object ) );
            }
        }
        if ( ( object = args.updated ) ) {
            list = Object.keys( object );
            if ( list.length ) {
                store.sourceDidCommitUpdate( list.map( toStoreKey ) )
                     .sourceDidFetchPartialRecords( accountId, Type, object );
            }
        }
        if ( ( object = args.notUpdated ) ) {
            list = Object.keys( object );
            if ( list.length ) {
                store.sourceDidNotUpdate(
                    list.map( toStoreKey ), true, Object.values( object ) );
            }
        }
        if ( ( list = args.destroyed ) && list.length ) {
            store.sourceDidCommitDestroy( list.map( toStoreKey ) );
        }
        if ( ( object = args.notDestroyed ) ) {
            list = Object.keys( object );
            if ( list.length ) {
                store.sourceDidNotDestroy(
                    list.map( toStoreKey ), true, Object.values( object ) );
            }
        }
        if ( args.newState ) {
            store.sourceCommitDidChangeState(
                accountId, Type, args.oldState, args.newState );
        }
    },

    didCopy: function ( Type, args ) {
        this.didCommit( Type, {
            accountId: args.accountId,
            updated: args.created,
            notUpdated: args.notCreated,
        });
    },

    /**
        Property: JMAP.Connection#response
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
            // eslint-disable-next-line no-console
            console.log( 'Unknown API call made: ' + requestName );
        },
        error_invalidArguments: function ( _, requestName, requestArgs ) {
            // eslint-disable-next-line no-console
            console.log( 'API call to ' + requestName +
                'made with invalid arguments: ', requestArgs );
        },
        error_anchorNotFound: function (/* args */) {
            // Don't need to do anything; it's only used for doing indexOf,
            // and it will just check that it doesn't have it.
        },
        error_accountNotFound: function () {
            // TODO: refetch accounts list.
        },
        error_accountReadOnly: function () {
            // TODO: refetch accounts list
        },
        error_accountNotSupportedByMethod: function () {
            // TODO: refetch accounts list
        },
    }
});

Connection.makeSetRequest = makeSetRequest;
Connection.makePatches = makePatches;

JMAP.Connection = Connection;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: connections.js                                                       \\
// Module: API                                                                \\
// Requires: Auth.js, Connection.js                                           \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const IOQueue = O.IOQueue;
const AggregateSource = O.AggregateSource;
const Store = O.Store;

const Connection = JMAP.Connection;
const auth = JMAP.auth;

// ---

const upload = new IOQueue({
    maxConnections: 3
});

const mail = new Connection({
    id: 'mail',
});
const contacts = new Connection({
    id: 'contacts',
});
const calendar = new Connection({
    id: 'calendar',
});
const peripheral = new Connection({
    id: 'peripheral',
});

const source = new AggregateSource({
    sources: [ mail, contacts, calendar, peripheral ],
    hasInFlightChanges: function () {
        return this.sources.some( function ( source ) {
            var inFlightRemoteCalls = source.get( 'inFlightRemoteCalls' );
            return inFlightRemoteCalls && inFlightRemoteCalls.some(
                function ( req ) {
                    var method = req[0];
                    return method.slice( 0, 3 ) !== 'get';
                });
        }) || !!upload.get( 'activeConnections' );
    },
});

const store = new Store({
    source: source,
    updateAccounts: function () {
        const accounts = auth.get( 'accounts' );
        var accountId, account, isDefault;
        for ( accountId in accounts ) {
            account = accounts[ accountId ];
            isDefault = account.isPrimary;
            this.addAccount( accountId, {
                isDefault: isDefault,
                hasDataFor: account.hasDataFor.reduce(
                function ( index, item ) {
                    index[ item ] = true;
                    return index;
                }, {} ),
            });
        }
    }
});
auth.addObserverForKey( 'accounts', store, 'updateAccounts' );

// --- Export

JMAP.upload = upload;
JMAP.mail = mail;
JMAP.contacts = contacts;
JMAP.calendar = calendar;
JMAP.peripheral = peripheral;
JMAP.source = source;
JMAP.store = store;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: LocalFile.js                                                         \\
// Module: API                                                                \\
// Requires: connections.js                                                   \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const Class = O.Class;
const Obj = O.Object;
const RunLoop = O.RunLoop;
const HttpRequest = O.HttpRequest;

const upload = JMAP.upload;
const auth = JMAP.auth;

// ---

const LocalFile = Class({

    Extends: Obj,

    nextEventTarget: upload,

    init: function ( file, accountId ) {
        this.file = file;
        this.accountId = accountId || auth.get( 'defaultAccountId' );
        this.blobId = '';

        this.name = file.name ||
            ( 'image.' + ( /\w+$/.exec( file.type ) || [ 'png' ] )[0] );
        this.type = file.type;
        this.size = file.size;

        this.isTooBig = false;
        this.isUploaded = false;

        this.progress = 0;
        this.loaded = 0;

        this._backoff = 500;

        LocalFile.parent.constructor.call( this );
    },

    destroy: function () {
        var request = this._request;
        if ( request ) {
            upload.abort( request );
        }
        LocalFile.parent.destroy.call( this );
    },

    upload: function ( obj, key ) {
        if ( obj && key ) {
            obj.removeObserverForKey( key, this, 'upload' );
        }
        if ( !this.isDestroyed ) {
            upload.send(
                this._request = new HttpRequest({
                    nextEventTarget: this,
                    method: 'POST',
                    url: auth.get( 'uploadUrl' ).replace(
                        '{accountId}', encodeURIComponent( this.accountId ) ),
                    headers: {
                        'Authorization': 'Bearer ' + auth.get( 'accessToken' ),
                    },
                    withCredentials: true,
                    responseType: 'json',
                    data: this.file,
                })
            );
        }
        return this;
    },

    _uploadDidProgress: function ( event ) {
        const loaded = event.loaded;
        const total = event.total;
        const delta = this.get( 'loaded' ) - loaded;
        const progress = ~~( 100 * loaded / total );
        this.set( 'progress', progress )
            .set( 'loaded', loaded )
            .fire( 'localfile:progress', {
                loaded: loaded,
                total: total,
                delta: delta,
                progress: progress,
            });
    }.on( 'io:uploadProgress' ),

    _uploadDidSucceed: function ( event ) {
        var response = event.data;
        var property;

        // Was there an error?
        if ( !response ) {
            return this.onFailure( event );
        }

        this.beginPropertyChanges();
        for ( property in response ) {
            // accountId, blobId, type, size
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
            auth.didLoseAuthentication()
                .addObserverForKey( 'isAuthenticated', this, 'upload' );
            break;
        case 404: // Not Found
            auth.fetchSessions()
                .addObserverForKey( 'uploadUrl', this, 'upload' );
            break;
        case 413: // Request Entity Too Large
            this.set( 'isTooBig', true );
            break;
        default:  // Connection failed or 503 Service Unavailable
            RunLoop.invokeAfterDelay( this.upload, this._backoff, this );
            this._backoff = Math.min( this._backoff * 2, 30000 );
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

    uploadDidSucceed: function () {
        this.fire( 'localfile:success' );
    },

    uploadDidFail: function () {
        this.fire( 'localfile:failure' );
    },
});

// --- Export

JMAP.LocalFile = LocalFile;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Sequence.js                                                          \\
// Module: API                                                                \\
// Requires: namespace.js                                                     \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const noop = function () {};

const Sequence = O.Class({

    Extends: O.Object,

    init: function () {
        this.queue = [];
        this.index = 0;
        this.length = 0;
        this.afterwards = noop;

        Sequence.parent.constructor.call( this );
    },

    then: function ( fn ) {
        this.queue.push( fn );
        this.increment( 'length', 1 );
        return this;
    },

    lastly: function ( fn ) {
        this.afterwards = fn;
        return this;
    },

    go: function go ( data ) {
        var index = this.index;
        var length = this.length;
        if ( index < length ) {
            this.set( 'index', index + 1 );
            this.queue[ index ]( go.bind( this ), data );
        } else if ( index === length ) {
            this.afterwards( index, length );
        }
        return this;
    },

    cancel: function () {
        var index = this.index;
        var length = this.length;
        if ( index < length ) {
            this.set( 'length', 0 );
            this.afterwards( index, length );
            this.fire( 'cancel' );
        }
        return this;
    },

    progress: function () {
        var index = this.index,
            length = this.length;
        return length ? Math.round( ( index / length ) * 100 ) : 100;
    }.property( 'index', 'length' ),
});

JMAP.Sequence = Sequence;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: getQueryId.js                                                        \\
// Module: API                                                                \\
// Requires: namespace.js                                                     \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP, JSON */

'use strict';

( function ( JMAP )  {

const guid = O.guid;

// ---

const stringifySorted = function ( item ) {
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

const getQueryId = function ( Type, args ) {
    return guid( Type ) + ':' + (
        ( args.accountId || '' ) +
        stringifySorted( args.where || args.filter ) +
        stringifySorted( args.sort )
    ).hash().toString();
};

// --- Export

JMAP.getQueryId = getQueryId;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Calendar.js                                                          \\
// Module: CalendarModel                                                      \\
// Requires: API                                                              \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP, undefined ) {

const loc = O.loc;
const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;
const ValidationError = O.ValidationError;
const DESTROYED = O.Status.DESTROYED;

// ---

const Calendar = Class({

    Extends: Record,

    name: attr( String, {
        defaultValue: '',
        validate: function ( propValue/*, propKey, record*/ ) {
            if ( !propValue ) {
                return new ValidationError( ValidationError.REQUIRED,
                    loc( 'S_LABEL_REQUIRED' )
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

    cascadeChange: function ( _, key, oldValue, newValue ) {
        var store = this.get( 'store' );
        var calendarSK = this.get( 'storeKey' );
        var property = 'calendar-' + key;
        if ( !store.isNested ) {
            store.getAll( JMAP.CalendarEvent, function ( data ) {
                return data.calendarId === calendarSK;
            }).forEach( function ( event ) {
                if ( event.get( 'recurrenceRule' ) ||
                        event.get( 'recurrenceOverrides' ) ) {
                    var cache = event._ocache;
                    var id;
                    for ( id in cache ) {
                        cache[ id ].propertyDidChange(
                            property, oldValue, newValue );
                    }
                } else {
                    event.propertyDidChange( property, oldValue, newValue );
                }
            });
        }
    }.observes( 'name', 'color' ),

    calendarWasDestroyed: function () {
        if ( this.get( 'status' ) === DESTROYED ) {
            var store = this.get( 'store' );
            var calendarSK = this.get( 'storeKey' );
            if ( !store.isNested ) {
                store.findAll( JMAP.CalendarEvent, function ( data ) {
                    return data.calendarId === calendarSK;
                }).forEach( function ( storeKey ) {
                    store.setStatus( storeKey, DESTROYED )
                         .unloadRecord( storeKey );
                });
            }
        }
    }.observes( 'status' ),

    // ---

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
});
Calendar.__guid__ = 'Calendar';
Calendar.dataGroup = 'calendars';

JMAP.calendar.handle( Calendar, {

    precedence: 1,

    fetch: function ( accountId, ids ) {
        this.callMethod( 'Calendar/get', {
            accountId: accountId,
            ids: ids || null,
        });
    },

    refresh: function ( accountId, ids, state ) {
        if ( ids ) {
            this.callMethod( 'Calendar/get', {
                accountId: accountId,
                ids: ids,
            });
        } else {
            this.callMethod( 'Calendar/changes', {
                accountId: accountId,
                sinceState: state,
                maxChanges: 100,
            });
            this.callMethod( 'Calendar/get', {
                accountId: accountId,
                '#ids': {
                    resultOf: this.getPreviousMethodId(),
                    name: 'Calendar/changes',
                    path: '/changed',
                },
            });
        }
    },

    commit: 'Calendar/set',

    // ---

    'Calendar/get': function ( args, reqMethod, reqArgs ) {
        const isAll = ( reqArgs.ids === null );
        this.didFetch( Calendar, args, isAll );
    },

    'Calendar/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( Calendar, args, hasDataForChanged );
        if ( args.hasMoreChanges ) {
            this.get( 'store' ).fetchAll( Calendar, true );
        }
    },

    'error_Calendar/changes_cannotCalculateChanges': function () {
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( Calendar );
    },

    'Calendar/set': function ( args ) {
        this.didCommit( Calendar, args );
    },
});

// --- Export

JMAP.Calendar = Calendar;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Duration.js                                                          \\
// Module: CalendarModel                                                      \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const durationFormat = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

const Duration = O.Class({
    init: function ( durationInMS ) {
        this._durationInMS = durationInMS;
    },

    valueOf: function () {
        return this._durationInMS;
    },

    toJSON: function () {
        var output = 'P';
        var durationInMS = this._durationInMS;
        var quantity;

        // Days. Also encompasses 0 duration. (P0D).
        if ( !durationInMS || durationInMS > 24 * 60 * 60 * 1000 ) {
            quantity = Math.floor( durationInMS / ( 24 * 60 * 60 * 1000 ) );
            output += quantity;
            output += 'D';
            durationInMS -= quantity * 24 * 60 * 60 * 1000;
        }

        if ( durationInMS ) {
            output += 'T';
            switch ( true ) {
            // Hours
            case durationInMS > 60 * 60 * 1000:
                quantity = Math.floor( durationInMS / ( 60 * 60 * 1000 ) );
                output += quantity;
                output += 'H';
                durationInMS -= quantity * 60 * 60 * 1000;
                /* falls through */
            // Minutes
            case durationInMS > 60 * 1000: // eslint-disable-line no-fallthrough
                quantity = Math.floor( durationInMS / ( 60 * 1000 ) );
                output += quantity;
                output += 'M';
                durationInMS -= quantity * 60 * 1000;
                /* falls through */
            // Seconds
            default: // eslint-disable-line no-fallthrough
                quantity = Math.floor( durationInMS / 1000 );
                output += quantity;
                output += 'S';
            }
        }

        return output;
    }
});

Duration.isEqual = function ( a, b ) {
    return a._durationInMS === b._durationInMS;
};

Duration.fromJSON = function ( value ) {
    var results = value ? durationFormat.exec( value ) : null;
    var durationInMS = 0;
    if ( results ) {
        durationInMS += ( +results[1] || 0 ) * 24 * 60 * 60 * 1000;
        durationInMS += ( +results[2] || 0 ) * 60 * 60 * 1000;
        durationInMS += ( +results[3] || 0 ) * 60 * 1000;
        durationInMS += ( +results[4] || 0 ) * 1000;
    }
    return new Duration( durationInMS );
};

Duration.ZERO = new Duration( 0 );
Duration.AN_HOUR = new Duration( 60 * 60 * 1000 );
Duration.A_DAY = new Duration( 24 * 60 * 60 * 1000 );

JMAP.Duration = Duration;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: RecurrenceRule.js                                                    \\
// Module: CalendarModel                                                      \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const toBoolean = O.Transform.toBoolean;
const Class = O.Class;

// ---

const none = 1 << 15;

const getMonth = function ( date, results ) {
    results[0] = date.getUTCMonth();
    results[1] = none;
    results[2] = none;
};

const getDate = function ( date, results, total ) {
    var daysInMonth = total || Date.getDaysInMonth(
            date.getUTCMonth(), date.getUTCFullYear() ) + 1;
    results[0] = date.getUTCDate();
    results[1] = results[0] - daysInMonth;
    results[2] = none;
};

const getDay = function ( date, results ) {
    results[0] = date.getUTCDay();
    results[1] = none;
    results[2] = none;
};

const getDayMonthly = function ( date, results, total ) {
    var day = date.getUTCDay();
    var monthDate = date.getUTCDate();
    var occurrence = Math.floor( ( monthDate - 1 ) / 7 ) + 1;
    var daysInMonth = total || Date.getDaysInMonth(
            date.getUTCMonth(), date.getUTCFullYear() );
    var occurrencesInMonth = occurrence +
            Math.floor( ( daysInMonth - monthDate ) / 7 );
    results[0] = day;
    results[1] = day + ( 7 * occurrence );
    results[2] = day + ( 7 * ( occurrence - occurrencesInMonth - 1 ) );
};

const getDayYearly = function ( date, results, daysInYear ) {
    var day = date.getUTCDay();
    var dayOfYear = date.getDayOfYear( true );
    var occurrence = Math.floor( ( dayOfYear - 1 ) / 7 ) + 1;
    var occurrencesInYear = occurrence +
            Math.floor( ( daysInYear - dayOfYear ) / 7 );
    results[0] = day;
    results[1] = day + ( 7 * occurrence );
    results[2] = day + ( 7 * ( occurrence - occurrencesInYear - 1 ) );
};

const getYearDay = function ( date, results, total ) {
    results[0] = date.getDayOfYear( true );
    results[1] = results[0] - total;
    results[2] = none;
};

const getWeekNo = function ( firstDayOfWeek, date, results, total ) {
    results[0] = date.getISOWeekNumber( firstDayOfWeek, true );
    results[1] = results[0] - total;
    results[2] = none;
};

const getPosition = function ( date, results, total, index ) {
    results[0] = index + 1;
    results[1] = index - total;
    results[2] = none;
};

const filter = function ( array, getValues, allowedValues, total ) {
    var l = array.length;
    var results = [ none, none, none ];
    var date, i, ll, a, b, c, allowed;
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

const expand = function ( array, property, values ) {
    var l = array.length, ll = values.length;
    var i, j, k = 0;
    var results = new Array( l * ll );
    var candidate, newCandidate;
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

// ---

const YEARLY = 1;
const MONTHLY = 2;
const WEEKLY = 3;
const DAILY = 4;
const HOURLY = 5;
const MINUTELY = 6;
const SECONDLY = 7;

const frequencyNumbers = {
    yearly: YEARLY,
    monthly: MONTHLY,
    weekly: WEEKLY,
    daily: DAILY,
    hourly: HOURLY,
    minutely: MINUTELY,
    secondly: SECONDLY,
};

const dayToNumber = {
    su: 0,
    mo: 1,
    tu: 2,
    we: 3,
    th: 4,
    fr: 5,
    sa: 6,
};

const numberToDay = [
    'su',
    'mo',
    'tu',
    'we',
    'th',
    'fr',
    'sa',
];

// ---

const RecurrenceRule = Class({

    init: function ( json ) {
        this.frequency = frequencyNumbers[ json.frequency ] || DAILY;
        this.interval = json.interval || 1;

        var firstDayOfWeek = dayToNumber[ json.firstDayOfWeek ];
        this.firstDayOfWeek =
            0 <= firstDayOfWeek && firstDayOfWeek < 7 ? firstDayOfWeek : 1;
        // Convert { day: "monday", nthOfPeriod: -1 } to -6 etc.
        this.byDay = json.byDay ? json.byDay.map( function ( nDay ) {
            return dayToNumber[ nDay.day ] + 7 * ( nDay.nthOfPeriod || 0 );
        }) : null;
        this.byMonthDay = json.byMonthDay || null;
        // Convert "1" (Jan), "2" (Feb) etc. to 0 (Jan), 1 (Feb)
        this.byMonth = json.byMonth ? json.byMonth.map( function ( month ) {
            return parseInt( month, 10 ) - 1;
        }) : null;
        this.byYearDay = json.byYearDay || null;
        this.byWeekNo = json.byWeekNo || null;

        this.byHour = json.byHour || null;
        this.byMinute = json.byMinute || null;
        this.bySecond = json.bySecond || null;

        this.bySetPosition = json.bySetPosition || null;

        this.until = json.until ? Date.fromJSON( json.until ) : null;
        this.count = json.count || null;

        this._isComplexAnchor = false;
    },

    toJSON: function () {
        var result = {};
        var key, value;
        for ( key in this ) {
            if ( key.charAt( 0 ) === '_' || !this.hasOwnProperty( key ) ) {
                continue;
            }
            value = this[ key ];
            if ( value === null ) {
                continue;
            }
            switch ( key ) {
            case 'frequency':
                value = Object.keyOf( frequencyNumbers, value );
                break;
            case 'interval':
                if ( value === 1 ) {
                    continue;
                }
                break;
            case 'firstDayOfWeek':
                if ( value === 1 ) {
                    continue;
                }
                value = numberToDay[ value ];
                break;
            case 'byDay':
                /* jshint ignore:start */
                value = value.map( function ( day ) {
                    return 0 <= day && day < 7 ? {
                        day: numberToDay[ day ]
                    } : {
                        day: numberToDay[ day.mod( 7 ) ],
                        nthOfPeriod: Math.floor( day / 7 )
                    };
                });
                break;
            case 'byMonth':
                value = value.map( function ( month ) {
                    return ( month + 1 ) + '';
                });
                /* jshint ignore:end */
                break;
            case 'until':
                value = value.toJSON();
                break;
            }
            result[ key ] = value;
        }
        return result;
    },

    // Returns the next set of dates revolving around the interval defined by
    // the fromDate. This may include dates *before* the from date.
    iterate: function ( fromDate, startDate ) {
        var frequency = this.frequency;
        var interval = this.interval;

        var firstDayOfWeek = this.firstDayOfWeek;

        var byDay = this.byDay;
        var byMonthDay = this.byMonthDay;
        var byMonth = this.byMonth;
        var byYearDay = this.byYearDay;
        var byWeekNo = this.byWeekNo;

        var byHour = this.byHour;
        var byMinute = this.byMinute;
        var bySecond = this.bySecond;

        var bySetPosition = this.bySetPosition;

        var candidates = [];
        var maxAttempts =
            ( frequency === YEARLY ) ? 10 :
            ( frequency === MONTHLY ) ? 24 :
            ( frequency === WEEKLY ) ? 53 :
            ( frequency === DAILY ) ? 366 :
            ( frequency === HOURLY ) ? 48 :
            /* MINUTELY || SECONDLY */ 120;

        var useFastPath, i, daysInMonth, offset, candidate, lastDayInYear;
        var weeksInYear, year, month, date, hour, minute, second;

        // Check it's sane.
        if ( interval < 1 ) {
            throw new Error( 'RecurrenceRule: Cannot have interval < 1' );
        }

        // Ignore illegal restrictions:
        if ( frequency !== YEARLY ) {
            byWeekNo = null;
        }
        switch ( frequency ) {
            case WEEKLY:
                byMonthDay = null;
                /* falls through */
            case DAILY:
            case MONTHLY:
                byYearDay = null;
                break;
        }

        // Only fill-in-the-blanks cases not handled by the fast path.
        if ( frequency === YEARLY ) {
            if ( byMonthDay && !byMonth && !byDay && !byYearDay && !byWeekNo ) {
                if ( byMonthDay.length === 1 &&
                        byMonthDay[0] === fromDate.getUTCDate() ) {
                    byMonthDay = null;
                } else {
                    byMonth = [ fromDate.getUTCMonth() ];
                }
            }
            if ( byMonth && !byMonthDay && !byDay && !byYearDay && !byWeekNo ) {
                byMonthDay = [ fromDate.getUTCDate() ];
            }
        }
        if ( frequency === MONTHLY && byMonth && !byMonthDay && !byDay ) {
            byMonthDay = [ fromDate.getUTCDate() ];
        }
        if ( frequency === WEEKLY && byMonth && !byDay ) {
            byDay = [ fromDate.getUTCDay() ];
        }

        // Deal with monthly/yearly repetitions where the anchor may not exist
        // in some cycles. Must not use fast path.
        if ( this._isComplexAnchor &&
                !byDay && !byMonthDay && !byMonth && !byYearDay && !byWeekNo ) {
            byMonthDay = [ startDate.getUTCDate() ];
            if ( frequency === YEARLY ) {
                byMonth = [ startDate.getUTCMonth() ];
            }
        }

        useFastPath = !byDay && !byMonthDay &&
            !byMonth && !byYearDay && !byWeekNo;
        switch ( frequency ) {
            case SECONDLY:
                useFastPath = useFastPath && !bySecond;
                /* falls through */
            case MINUTELY:
                useFastPath = useFastPath && !byMinute;
                /* falls through */
            case HOURLY:
                useFastPath = useFastPath && !byHour;
                break;
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
            if ( useFastPath ) {
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
                    lastDayInYear = new Date( Date.UTC(
                        year, 11, 31, hour, minute, second
                    ));
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
                if ( byMonthDay ) {
                    filter( candidates, getDate, byMonthDay,
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
                        lastDayInYear.getDayOfYear( true ) + 1
                    );
                }
                if ( byWeekNo ) {
                    weeksInYear =
                        lastDayInYear.getISOWeekNumber( firstDayOfWeek, true );
                    if ( weeksInYear === 1 ) {
                        weeksInYear = 52;
                    }
                    filter( candidates, getWeekNo.bind( null, firstDayOfWeek ),
                        byWeekNo,
                        weeksInYear + 1
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
        var frequency = this.frequency;
        var count = this.count || 0;
        var until = this.until;
        var results = [];
        var interval, year, month, date, isComplexAnchor;
        var beginYear, beginMonth;
        var anchor, temp, occurrences, occurrence, i, l;

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
    },

    matches: function ( start, date ) {
        return !!this.getOccurrences( start, date, new Date( +date + 1000 ) )
                     .length;
    },
});

RecurrenceRule.dayToNumber = dayToNumber;
RecurrenceRule.numberToDay = numberToDay;

RecurrenceRule.fromJSON = function ( recurrenceRuleJSON ) {
    return new RecurrenceRule( recurrenceRuleJSON );
};

// --- Export

JMAP.RecurrenceRule = RecurrenceRule;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: calendarEventUploads.js                                              \\
// Module: CalendarModel                                                      \\
// Requires: API                                                              \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const clone = O.clone;
const Class = O.Class;

const store = JMAP.store;
const calendar = JMAP.calendar;
const LocalFile = JMAP.LocalFile;

// ---

const eventUploads = {

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
        event.getDoppelganger( store )
                 .computedPropertyDidChange( 'files' );
    },

    discard: function ( event ) {
        this.finishEdit( event, 'inServer', 'inEdit' );
        event.getDoppelganger( calendar.editStore )
                .computedPropertyDidChange( 'files' );
    },

    didUpload: function ( file ) {
        var inEdit = file.inEdit,
            inServer = file.inServer,
            link = {
                href: file.get( 'url' ),
                rel: 'enclosure',
                title: file.get( 'name' ),
                type: file.get( 'type' ),
                size: file.get( 'size' )
            },
            editEvent = file.editEvent,
            editLinks = clone( editEvent.get( 'links' ) ) || {},
            id, awaitingSave,
            serverEvent, serverLinks;

        if ( !inServer ) {
            id = editEvent.get( 'storeKey' );
            awaitingSave = this.awaitingSave;
            ( awaitingSave[ id ] ||
                ( awaitingSave[ id ] = [] ) ).push([
                    file.get( 'path' ), file.get( 'name' ) ]);
            editLinks[ link.href ] = link;
            editEvent.set( 'links', editLinks );
            this.remove( editEvent, file );
        } else {
            this.keepFile( file.get( 'path' ), file.get( 'name' ) );
            // Save new attachment to server
            serverEvent = editEvent.getDoppelganger( store );
            serverLinks = clone( serverEvent.get( 'links' ) ) || {};
            serverLinks[ link.href ] = link;
            serverEvent.set( 'links', serverLinks );
            // If in edit, push to edit record as well.
            if ( inEdit ) {
                editLinks[ link.href ] = link;
            }
            editEvent.set( 'links', editLinks );
            this.remove( serverEvent, file );
        }
    },

    didFail: function ( file ) {
        var event = file.editEvent;
        file.inServer = false;
        this.remove( event, file );
        event.getDoppelganger( store )
             .computedPropertyDidChange( 'files' );
    },

    keepFile: function ( path, name ) {
        // TODO: Create Storage Node in Calendar Event Attachments folder.
    },
};

const CalendarAttachment = Class({

    Extends: LocalFile,

    init: function ( file, event ) {
        this.editEvent = event;
        this.inServer = false;
        this.inEdit = true;
        CalendarAttachment.parent.constructor.call( this, file );
    },

    uploadDidSucceed: function () {
        eventUploads.didUpload( this );
    },
    uploadDidFail: function () {
        eventUploads.didFail( this );
    }
});

// --- Export

JMAP.CalendarAttachment = CalendarAttachment;
JMAP.calendar.eventUploads = eventUploads;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: CalendarEvent.js                                                     \\
// Module: CalendarModel                                                      \\
// Requires: API, Calendar.js, Duration.js, RecurrenceRule.js, calendarEventUploads.js \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP, undefined ) {

const clone = O.clone;
const Class = O.Class;
const Obj = O.Object;
const Record = O.Record;
const attr = Record.attr;
const TimeZone = O.TimeZone;

const calendar = JMAP.calendar;
const Calendar = JMAP.Calendar;
const CalendarAttachment = JMAP.CalendarAttachment;
const Duration = JMAP.Duration;
const RecurrenceRule = JMAP.RecurrenceRule;

// ---

const numerically = function ( a, b ) {
    return a - b;
};

const CalendarEvent = Class({

    Extends: Record,

    isDragging: false,
    isOccurrence: false,

    isEditable: function () {
        var calendar = this.get( 'calendar' );
        return ( !calendar || calendar.get( 'mayWrite' ) );
    }.property( 'calendar' ),

    isInvitation: function () {
        var participants = this.get( 'participants' );
        var participantId = this.get( 'participantId' );
        return !!( participants && (
            !participantId ||
            !participants[ participantId ].roles.contains( 'owner' )
        ));
    }.property( 'participants', 'participantId' ),

    storeWillUnload: function () {
        this._clearOccurrencesCache();
        CalendarEvent.parent.storeWillUnload.call( this );
    },

    // --- JMAP

    calendar: Record.toOne({
        Type: Calendar,
        key: 'calendarId',
        willSet: function ( propValue, propKey, record ) {
            record.set( 'accountId', propValue.get( 'accountId' ) );
            return true;
        },
    }),

    // --- Metadata

    '@type': attr( String, {
        defaultValue: 'jsevent',
    }),

    uid: attr( String, {
        noSync: true,
    }),

    relatedTo: attr( Object ),

    prodId: attr( String ),

    created: attr( Date, {
        toJSON: Date.toUTCJSON,
        noSync: true,
    }),

    updated: attr( Date, {
        toJSON: Date.toUTCJSON,
        noSync: true,
    }),

    sequence: attr( Number, {
        defaultValue: 0,
        noSync: true,
    }),

    // method: attr( String, {
    //     noSync: true,
    // }),

    // --- What

    title: attr( String, {
        defaultValue: '',
    }),

    description: attr( String, {
        defaultValue: '',
    }),

    // --- Where

    locations: attr( Object, {
        defaultValue: null,
    }),

    location: function ( value ) {
        if ( value !== undefined ) {
            this.set( 'locations', value ? {
                '1': {
                    name: value
                }
            } : null );
        } else {
            var locations = this.get( 'locations' );
            if ( locations ) {
                value = Object.values( locations )[0].name || '';
            } else {
                value = '';
            }
        }
        return value;
    }.property( 'locations' ).nocache(),

    startLocationTimeZone: function () {
        var locations = this.get( 'locations' );
        var timeZone = this.get( 'timeZone' );
        var id, location;
        if ( timeZone ) {
            for ( id in locations ) {
                location = locations[ id ];
                if ( location.rel === 'start' ) {
                    if ( location.timeZone ) {
                        timeZone = TimeZone.fromJSON( location.timeZone );
                    }
                    break;
                }
            }
        }
        return timeZone;
    }.property( 'locations', 'timeZone' ),

    endLocationTimeZone: function () {
        var locations = this.get( 'locations' );
        var timeZone = this.get( 'timeZone' );
        var id, location;
        if ( timeZone ) {
            for ( id in locations ) {
                location = locations[ id ];
                if ( location.rel === 'end' ) {
                    if ( location.timeZone ) {
                        timeZone = TimeZone.fromJSON( location.timeZone );
                    }
                    break;
                }
            }
        }
        return timeZone;
    }.property( 'locations', 'timeZone' ),

    // --- Attachments

    links: attr( Object, {
        defaultValue: null,
    }),

    isUploading: function () {
        return !!calendar.eventUploads.get( this ).length;
    }.property( 'files' ),

    files: function () {
        var links = this.get( 'links' ) || {};
        var files = [];
        var id, link;
        for ( id in links ) {
            link = links[ id ];
            if ( link.rel === 'enclosure' ) {
                files.push( new Obj({
                    id: id,
                    name: link.title,
                    url: link.href,
                    type: link.type,
                    size: link.size
                }));
            }
        }
        return files.concat( calendar.eventUploads.get( this ) );
    }.property( 'links' ),

    addFile: function ( file ) {
        var attachment = new CalendarAttachment( file, this );
        calendar.eventUploads.add( this, attachment );
        attachment.upload();
        return this;
    },

    removeFile: function ( file ) {
        if ( file instanceof CalendarAttachment ) {
            calendar.eventUploads.remove( this, file );
        } else {
            var links = clone( this.get( 'links' ) );
            delete links[ file.id ];
            this.set( 'links', Object.keys( links ).length ? links : null );
        }
        return this;
    },

    // ---

    // locale: attr( String ),
    // localizations: attr( Object ),

    // keywords: attr( Array ),
    // categories: attr( Array ),
    // color: attr( String ),

    // --- When

    isAllDay: attr( Boolean, {
        defaultValue: false,
    }),

    start: attr( Date, {
        willSet: function ( propValue, propKey, record ) {
            var oldStart = record.get( 'start' );
            if ( typeof oldStart !== 'undefined' ) {
                record._updateRecurrenceOverrides( oldStart, propValue );
            }
            return true;
        }
    }),

    duration: attr( Duration, {
        defaultValue: Duration.ZERO,
    }),

    timeZone: attr( TimeZone, {
        defaultValue: null,
    }),

    recurrenceRule: attr( RecurrenceRule, {
        defaultValue: null,
        willSet: function ( propValue, propKey, record ) {
            if ( !propValue ) {
                record.set( 'recurrenceOverrides', null );
            }
            return true;
        },
    }),

    recurrenceOverrides: attr( Object, {
        defaultValue: null,
    }),

    getStartInTimeZone: function ( timeZone ) {
        var eventTimeZone = this.get( 'timeZone' );
        var start, cacheKey;
        if ( eventTimeZone && timeZone && timeZone !== eventTimeZone ) {
            start = this.get( 'utcStart' );
            cacheKey = timeZone.id + start.toJSON();
            if ( this._ce_sk === cacheKey ) {
                return this._ce_s;
            }
            this._ce_sk = cacheKey;
            this._ce_s = start = timeZone.convertDateToTimeZone( start );
        } else {
            start = this.get( 'start' );
        }
        return start;
    },

    getEndInTimeZone: function ( timeZone ) {
        var eventTimeZone = this.get( 'timeZone' );
        var end = this.get( 'utcEnd' );
        var cacheKey;
        if ( eventTimeZone ) {
            if ( !timeZone ) {
                timeZone = eventTimeZone;
            }
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
        var timeZone = this.get( 'timeZone' );
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
    }.property( 'start', 'timeZone' ),

    utcEnd: function ( date ) {
        var utcStart = this.get( 'utcStart' );
        if ( date ) {
            this.set( 'duration', new Duration(
                Math.max( 0, date - utcStart )
            ));
        } else {
            date = new Date( +utcStart + this.get( 'duration' ) );
        }
        return date;
    }.property( 'utcStart', 'duration' ),

    end: function ( date ) {
        var isAllDay = this.get( 'isAllDay' );
        var timeZone = this.get( 'timeZone' );
        var utcStart, utcEnd;
        if ( date ) {
            utcStart = this.get( 'utcStart' );
            utcEnd = timeZone ?
                timeZone.convertDateToUTC( date ) : new Date( date );
            if ( isAllDay ) {
                utcEnd.add( 1, 'day' );
            }
            if ( utcStart > utcEnd ) {
                if ( isAllDay ||
                        !this.get( 'start' ).isOnSameDayAs( date, true ) ) {
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
            date = this.getEndInTimeZone( timeZone );
            if ( isAllDay ) {
                date = new Date( date ).subtract( 1, 'day' );
            }
        }
        return date;
    }.property( 'isAllDay', 'start', 'duration', 'timeZone' ),

    _updateRecurrenceOverrides: function ( oldStart, newStart ) {
        var recurrenceOverrides = this.get( 'recurrenceOverrides' );
        var newRecurrenceOverrides, delta, date;
        if ( recurrenceOverrides ) {
            delta = newStart - oldStart;
            newRecurrenceOverrides = {};
            for ( date in recurrenceOverrides ) {
                newRecurrenceOverrides[
                    new Date( +Date.fromJSON( date ) + delta ).toJSON()
                ] = recurrenceOverrides[ date ];
            }
            this.set( 'recurrenceOverrides', newRecurrenceOverrides );
        }
    },

    removedDates: function () {
        var recurrenceOverrides = this.get( 'recurrenceOverrides' );
        var dates = null;
        var date;
        if ( recurrenceOverrides ) {
            for ( date in recurrenceOverrides ) {
                if ( !recurrenceOverrides[ date ] ) {
                    if ( !dates ) { dates = []; }
                    dates.push( Date.fromJSON( date ) );
                }
            }
        }
        if ( dates ) {
            dates.sort( numerically );
        }
        return dates;
    }.property( 'recurrenceOverrides' ),

    _getOccurrenceForRecurrenceId: function ( id ) {
        var cache = this._ocache || ( this._ocache = {} );
        return cache[ id ] || ( cache[ id ] =
            new JMAP.CalendarEventOccurrence( this, id )
        );
    },

    // Return all occurrences that exist in this time range.
    // May return others outside of this range.
    // May return out of order.
    getOccurrencesThatMayBeInDateRange: function ( start, end, timeZone ) {
        // Get start time and end time in the event's time zone.
        var eventTimeZone = this.get( 'timeZone' );
        var recurrenceRule = this.get( 'recurrenceRule' );
        var recurrenceOverrides = this.get( 'recurrenceOverrides' );
        var duration, earliestStart;
        var occurrences, occurrencesSet, id, occurrence, date;
        var occurrenceIds, recurrences;

        // Convert start/end to local time
        if ( timeZone && eventTimeZone && timeZone !== eventTimeZone ) {
            start = timeZone.convertDateToUTC( start );
            start = eventTimeZone.convertDateToTimeZone( start );
            end = timeZone.convertDateToUTC( end );
            end = eventTimeZone.convertDateToTimeZone( end );
        }

        // Calculate earliest possible start date, given duration.
        // To prevent pathological cases, we limit duration to
        // the frequency of the recurrence.
        if ( recurrenceRule ) {
            duration = this.get( 'duration' ).valueOf();
            switch ( recurrenceRule.frequency ) {
            case 'yearly':
                duration = Math.min( duration, 366 * 24 * 60 * 60 * 1000 );
                break;
            case 'monthly':
                duration = Math.min( duration,  31 * 24 * 60 * 60 * 1000 );
                break;
            case 'weekly':
                duration = Math.min( duration,   7 * 24 * 60 * 60 * 1000 );
                break;
            default:
                duration = Math.min( duration,       24 * 60 * 60 * 1000 );
                break;
            }
            earliestStart = new Date( start - duration + 1000 );
        }

        // Precompute count, as it's expensive to do each time.
        if ( recurrenceRule && recurrenceRule.count ) {
            occurrences = this.get( 'allStartDates' );
            recurrences = occurrences.length ?
                occurrences.map( function ( date ) {
                    return this._getOccurrenceForRecurrenceId( date.toJSON() );
                }, this ) :
                null;
        } else {
            // Get occurrences that start within the time period.
            if ( recurrenceRule ) {
                occurrences = recurrenceRule.getOccurrences(
                    this.get( 'start' ), earliestStart, end
                );
            }
            // Or just the start if no recurrence rule.
            else {
                occurrences = [ this.get( 'start' ) ];
            }
            // Add overrides.
            if ( recurrenceOverrides ) {
                occurrencesSet = occurrences.reduce( function ( set, date ) {
                    set[ date.toJSON() ] = true;
                    return set;
                }, {} );
                for ( id in recurrenceOverrides ) {
                    occurrence = recurrenceOverrides[ id ];
                    // Remove EXDATEs.
                    if ( occurrence === null ) {
                        delete occurrencesSet[ id ];
                    }
                    // Add RDATEs.
                    else {
                        date = Date.fromJSON( id );
                        // Include if in date range, or if it alters the date.
                        if ( ( earliestStart <= date && date < end ) ||
                                occurrence.start ||
                                occurrence.duration ||
                                occurrence.timeZone ) {
                            occurrencesSet[ id ] = true;
                        }
                    }
                }
                occurrenceIds = Object.keys( occurrencesSet );
            } else {
                occurrenceIds = occurrences.map( function ( date ) {
                    return date.toJSON();
                });
            }
            // Get event occurrence objects
            recurrences = occurrenceIds.length ?
                occurrenceIds.map( this._getOccurrenceForRecurrenceId, this ) :
                null;
        }

        return recurrences;
    },

    // Exceptions changing the date/time of an occurrence are ignored: the
    // *original* date/time is still included in the allStartDates array.
    allStartDates: function () {
        var recurrenceRule = this.get( 'recurrenceRule' );
        var recurrenceOverrides = this.get( 'recurrenceOverrides' );
        var start = this.get( 'start' );
        var dates, occurrencesSet, id;

        if ( recurrenceRule &&
                !recurrenceRule.until && !recurrenceRule.count ) {
            return [ start ];
        }
        if ( recurrenceRule ) {
            dates = recurrenceRule.getOccurrences( start, null, null );
        } else {
            dates = [ start ];
        }
        if ( recurrenceOverrides ) {
            occurrencesSet = dates.reduce( function ( set, date ) {
                set[ date.toJSON() ] = true;
                return set;
            }, {} );
            for ( id in recurrenceOverrides ) {
                // Remove EXDATEs.
                if ( recurrenceOverrides[ id ] === null ) {
                    delete occurrencesSet[ id ];
                }
                // Add RDATEs.
                else {
                    occurrencesSet[ id ] = true;
                }
            }
            dates = Object.keys( occurrencesSet ).map( Date.fromJSON );
            dates.sort( numerically );
        }
        return dates;
    }.property( 'start', 'recurrenceRule', 'recurrenceOverrides' ),

    totalOccurrences: function () {
        var recurrenceRule = this.get( 'recurrenceRule' );
        var recurrenceOverrides = this.get( 'recurrenceOverrides' );
        if ( !recurrenceRule && !recurrenceOverrides ) {
            return 1;
        }
        if ( recurrenceRule &&
                !recurrenceRule.count && !recurrenceRule.until ) {
            return Number.MAX_VALUE;
        }
        return this.get( 'allStartDates' ).length;
    }.property( 'allStartDates' ),

    _clearOccurrencesCache: function () {
        var cache = this._ocache;
        var id;
        if ( cache ) {
            for ( id in cache ) {
                cache[ id ].unload();
            }
            this._ocache = null;
        }
    }.observes( 'start', 'timeZone', 'recurrence' ),

    _notifyOccurrencesOfPropertyChange: function ( _, key ) {
        var cache = this._ocache;
        var id;
        if ( cache ) {
            for ( id in cache ) {
                cache[ id ].propertyDidChange( key );
            }
        }
    }.observes( 'calendar', 'uid', 'relatedTo', 'prodId', 'isAllDay',
        'allStartDates', 'totalOccurrences', 'replyTo', 'participantId' ),

    // --- Scheduling

    // priority: attr( Number, {
    //     defaultValue: 0,
    // }),

    scheduleStatus: attr( String, {
        key: 'status',
        defaultValue: 'confirmed',
    }),

    freeBusyStatus: attr( String, {
        defaultValue: 'busy',
    }),

    replyTo: attr( Object, {
        defaultValue: null,
    }),

    participants: attr( Object, {
        defaultValue: null,
    }),

    // --- JMAP Scheduling

    // The id for the calendar owner's participant
    participantId: attr( String, {
        defaultValue: null,
    }),

    rsvp: function ( rsvp ) {
        var participants = this.get( 'participants' );
        var participantId = this.get( 'participantId' );
        var you = ( participants && participantId &&
            participants[ participantId ] ) || null;
        if ( you && rsvp !== undefined ) {
            participants = clone( participants );
            // Don't alert me if I'm not going!
            if ( rsvp === 'declined' ) {
                this.set( 'useDefaultAlerts', false )
                    .set( 'alerts', null );
            }
            // Do alert me if I change my mind!
            else if ( you.rsvpResponse === 'declined' &&
                    this.get( 'alerts' ) === null ) {
                this.set( 'useDefaultAlerts', true );
            }
            participants[ participantId ].rsvpResponse = rsvp;
            this.set( 'participants', participants );
        } else {
            rsvp = you && you.rsvpResponse || '';
        }
        return rsvp;
    }.property( 'participants', 'participantId' ),

    // --- Sharing

    // privacy: attr( String, {
    //     defaultValue: 'public',
    // }),

    // --- Alerts

    useDefaultAlerts: attr( Boolean, {
        defaultValue: false,
    }),

    alerts: attr( Object, {
        defaultValue: null,
    }),
});
CalendarEvent.__guid__ = 'CalendarEvent';
CalendarEvent.dataGroup = 'calendars';

// ---

const dayToNumber = RecurrenceRule.dayToNumber;

const byNthThenDay = function ( a, b ) {
    var aNthOfPeriod = a.nthOfPeriod || 0;
    var bNthOfPeriod = b.nthOfPeriod || 0;
    return ( aNthOfPeriod - bNthOfPeriod ) ||
        ( dayToNumber[ a.day ] - dayToNumber[ b.day ] );
};

const numericArrayProps = [ 'byMonthDay', 'byYearDay', 'byWeekNo', 'byHour', 'byMinute', 'bySecond', 'bySetPosition' ];

const normaliseRecurrenceRule = function ( recurrenceRuleJSON ) {
    var byDay, byMonth, i, l, key, value;
    if ( !recurrenceRuleJSON ) {
        return;
    }
    if ( recurrenceRuleJSON.interval === 1 ) {
        delete recurrenceRuleJSON.interval;
    }
    if ( recurrenceRuleJSON.firstDayOfWeek === 'monday' ) {
        delete recurrenceRuleJSON.firstDayOfWeek;
    }
    if (( byDay = recurrenceRuleJSON.byDay )) {
        if ( byDay.length ) {
            byDay.sort( byNthThenDay );
        } else {
            delete recurrenceRuleJSON.byDay;
        }
    }
    if (( byMonth = recurrenceRuleJSON.byMonth )) {
        if ( byMonth.length ) {
            byMonth.sort();
        } else {
            delete recurrenceRuleJSON.byMonth;
        }
    }
    for ( i = 0, l = numericArrayProps.length; i < l; i += 1 ) {
        key = numericArrayProps[i];
        value = recurrenceRuleJSON[ key ];
        if ( value ) {
            // Must be sorted
            if ( value.length ) {
                value.sort( numerically );
            }
            // Must not be empty
            else {
                delete recurrenceRuleJSON[ key ];
            }
        }
    }
};

const alertOffsetFromJSON = function ( alerts ) {
    if ( !alerts ) {
        return null;
    }
    var id, alert;
    for ( id in alerts ) {
        alert = alerts[ id ];
        alert.offset = new Duration( alert.offset );
    }
};

calendar.replaceEvents = {};
calendar.handle( CalendarEvent, {

    precedence: 2,

    fetch: function ( accountId, ids ) {
        this.callMethod( 'CalendarEvent/get', {
            accountId: accountId,
            ids: ids || null,
        });
    },

    refresh: function ( accountId, ids, state ) {
        if ( ids ) {
            this.callMethod( 'CalendarEvent/get', {
                accountId: accountId,
                ids: ids,
            });
        } else {
            this.callMethod( 'CalendarEvent/changes', {
                accountId: accountId,
                sinceState: state,
                maxChanges: 100,
            });
            this.callMethod( 'CalendarEvent/get', {
                accountId: accountId,
                '#ids': {
                    resultOf: this.getPreviousMethodId(),
                    name: 'CalendarEvent/changes',
                    path: '/changed',
                },
            });
        }
    },

    commit: 'CalendarEvent/set',

    // ---

    'CalendarEvent/get': function ( args ) {
        var events = args.list;
        var l = events.length;
        var event, timeZoneId;
        var accountId = args.accountId;
        while ( l-- ) {
            event = events[l];
            timeZoneId = event.timeZone;
            if ( timeZoneId ) {
                calendar.seenTimeZone( TimeZone[ timeZoneId ] );
            }
            normaliseRecurrenceRule( event.recurrenceRule );
            alertOffsetFromJSON( event.alerts );
        }
        calendar.propertyDidChange( 'usedTimeZones' );
        this.didFetch( CalendarEvent, args, !!this.replaceEvents[ accountId ] );
        this.replaceEvents[ accountId ] = false;
    },

    'CalendarEvent/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( CalendarEvent, args, hasDataForChanged );
        if ( args.hasMoreChanges ) {
            this.get( 'store' ).fetchAll( args.accountId, CalendarEvent, true );
        }
    },

    'error_CalendarEvent/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var accountId = reqArgs.accountId;
        calendar.flushCache( accountId );
    },

    'CalendarEvent/set': function ( args ) {
        this.didCommit( CalendarEvent, args );
    },
});

// --- Export

JMAP.CalendarEvent = CalendarEvent;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: CalendarEventOccurrence.js                                           \\
// Module: CalendarModel                                                      \\
// Requires: CalendarEvent.js                                                 \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP, undefined ) {

const bind = O.bind;
const meta = O.meta;
const clone = O.clone;
const isEqual = O.isEqual;
const TimeZone = O.TimeZone;
const Class = O.Class;
const Obj = O.Object;

const makePatches = JMAP.Connection.makePatches;
const CalendarEvent = JMAP.CalendarEvent;

// ---

const mayPatch = {
    links: true,
    translations: true,
    locations: true,
    participants: true,
    alerts: true,
};

const applyPatch = function ( object, path, patch ) {
    var slash, key;
    while ( true ) {
        // Invalid patch; path does not exist
        if ( !object ) {
            return;
        }
        slash = path.indexOf( '/' );
        if ( slash > -1 ) {
            key = path.slice( 0, slash );
            path = path.slice( slash + 1 );
        }
        if ( key ) {
            key = key.replace( /~1/g, '/' ).replace( /~0/g, '~' );
        }
        if ( slash > -1 ) {
            object = object[ key ];
        } else {
            if ( patch !== null ) {
                object[ key ] = patch;
            } else {
                delete object[ key ];
            }
            break;
        }
    }
};

const proxyOverrideAttibute = function ( Type, key, attrKey ) {
    return function ( value ) {
        var original = this.get( 'original' );
        var originalValue = this.getOriginalForKey( key );
        var id = this.id;
        var recurrenceOverrides, recurrenceRule;
        var overrides, keepOverride, path;

        if ( !attrKey ) {
            attrKey = key;
        }

        if ( value !== undefined ) {
            // Get current overrides for occurrence
            recurrenceOverrides =
                clone( original.get( 'recurrenceOverrides' ) ) || {};
            overrides = recurrenceOverrides[ id ] ||
                ( recurrenceOverrides[ id ] = {} );

            // Clear any previous overrides for this key
            keepOverride = false;
            for ( path in overrides ) {
                if ( path.indexOf( attrKey ) === 0 ) {
                    delete overrides[ path ];
                } else {
                    keepOverride = true;
                }
            }
            // Set if different to parent
            if ( mayPatch[ attrKey ] ) {
                keepOverride =
                    makePatches( attrKey, overrides, originalValue, value ) ||
                    keepOverride;
            } else if ( !isEqual( originalValue, value ) ) {
                keepOverride = true;
                overrides[ attrKey ] = value && value.toJSON ?
                    value.toJSON() : value;
            }

            // Check if we still have any overrides
            if ( !keepOverride ) {
                // Check if matches recurrence rule. If not, keep.
                recurrenceRule = original.get( 'recurrenceRule' );
                if ( recurrenceRule &&
                        recurrenceRule.matches(
                            original.get( 'start' ), this._start
                        )) {
                    delete recurrenceOverrides[ id ];
                }
            }
            if ( !Object.keys( recurrenceOverrides ).length ) {
                recurrenceOverrides = null;
            }

            // Set on original
            original.set( 'recurrenceOverrides', recurrenceOverrides );
        } else {
            overrides = this.get( 'overrides' );
            if ( attrKey in overrides ) {
                return Type.fromJSON ?
                    Type.fromJSON( overrides[ attrKey ] ) :
                    overrides[ attrKey ];
            }
            value = originalValue;
            if ( value && mayPatch[ attrKey ] ) {
                for ( path in overrides ) {
                    if ( path.indexOf( attrKey ) === 0 ) {
                        if ( value === originalValue ) {
                            value = clone( originalValue );
                        }
                        applyPatch( value, path, overrides[ path ] );
                    }
                }
            }
        }
        return value;
    }.property( 'overrides', 'original.' + key );
};

const proxyAttribute = function ( _, key ) {
    return this.get( 'original' ).get( key );
}.property().nocache();

const CalendarEventOccurrence = Class({

    Extends: Obj,

    constructor: CalendarEvent,

    isDragging: false,
    isOccurrence: true,

    isEditable: CalendarEvent.prototype.isEditable,
    isInvitation: CalendarEvent.prototype.isInvitation,

    overrides: bind( null, 'original*recurrenceOverrides',
    function ( recurrenceOverrides ) {
        var id = this.toObject.id;
        return recurrenceOverrides && recurrenceOverrides[ id ] || {};
    }),

    init: function ( original, id ) {
        this._start = Date.fromJSON( id );

        this.id = id;
        this.original = original;
        // For attachment upload only
        this.store = original.get( 'store' );
        this.storeKey = original.get( 'storeKey' ) + id;

        CalendarEventOccurrence.parent.constructor.call( this );
        original.on( 'highlightView', this, 'echoEvent' );
    },

    getOriginalForKey: function ( key ) {
        if ( key === 'start' ) {
            return this._start;
        }
        return this.get( 'original' ).get( key );
    },

    getDoppelganger: function ( store ) {
        var original = this.get( 'original' );
        var originalStore = original.get( 'store' );
        if ( originalStore === store ) {
            return this;
        }
        return original.getDoppelganger( store )
                       ._getOccurrenceForRecurrenceId( this.id );
    },

    clone: CalendarEvent.prototype.clone,

    destroy: function () {
        var original = this.get( 'original' );
        var recurrenceOverrides = original.get( 'recurrenceOverrides' );

        recurrenceOverrides = recurrenceOverrides ?
            clone( recurrenceOverrides ) : {};
        recurrenceOverrides[ this.id ] = null;
        original.set( 'recurrenceOverrides', recurrenceOverrides );

        this.unload();
    },

    unload: function () {
        this.get( 'original' ).off( 'highlightView', this, 'echoEvent' );
        CalendarEventOccurrence.parent.destroy.call( this );
    },

    is: function ( status ) {
        return this.get( 'original' ).is( status );
    },

    echoEvent: function ( event ) {
        this.fire( event.type, event );
    },

    // ---

    // May not edit calendar prop.
    calendar: proxyAttribute,

    '@type': 'jsevent',
    uid: proxyAttribute,
    relatedTo: proxyAttribute,
    prodId: proxyAttribute,

    created: proxyOverrideAttibute( Date, 'created' ),
    updated: proxyOverrideAttibute( Date, 'updated' ),
    sequence: proxyOverrideAttibute( Number, 'sequence' ),

    // ---

    title: proxyOverrideAttibute( String, 'title' ),
    description: proxyOverrideAttibute( String, 'description' ),

    // ---

    locations: proxyOverrideAttibute( Object, 'locations' ),
    location: CalendarEvent.prototype.location,
    startLocationTimeZone: CalendarEvent.prototype.startLocationTimeZone,
    endLocationTimeZone: CalendarEvent.prototype.endLocationTimeZone,

    // ---

    links: proxyOverrideAttibute( Object, 'links' ),

    isUploading: CalendarEvent.prototype.isUploading,
    files: CalendarEvent.prototype.files,
    addFile: CalendarEvent.prototype.addFile,
    removeFile: CalendarEvent.prototype.removeFile,

    // ---

    // locale: attr( String ),
    // localizations: attr( Object ),

    // keywords: attr( Array ),
    // categories: attr( Array ),
    // color: attr( String ),

    // ---

    isAllDay: proxyAttribute,

    start: proxyOverrideAttibute( Date, 'start' ),
    duration: proxyOverrideAttibute( JMAP.Duration, 'duration' ),
    timeZone: proxyOverrideAttibute( TimeZone, 'timeZone' ),
    recurrenceRule: proxyAttribute,
    recurrenceOverrides: null,

    getStartInTimeZone: CalendarEvent.prototype.getStartInTimeZone,
    getEndInTimeZone: CalendarEvent.prototype.getEndInTimeZone,

    utcStart: CalendarEvent.prototype.utcStart,
    utcEnd: CalendarEvent.prototype.utcEnd,

    end: CalendarEvent.prototype.end,

    removedDates: null,

    allStartDates: proxyAttribute,
    totalOccurrences: proxyAttribute,

    index: function () {
        var start = this.get( 'start' );
        var original = this.get( 'original' );
        return isEqual( start, original.get( 'start' ) ) ? 0 :
            original.get( 'allStartDates' ).binarySearch( this._start );
    }.property().nocache(),

    // ---

    scheduleStatus: proxyOverrideAttibute( String, 'scheduleStatus', 'status' ),
    freeBusyStatus: proxyOverrideAttibute( String, 'freeBusyStatus' ),
    replyTo: proxyAttribute,
    participants: proxyOverrideAttibute( Object, 'participants' ),
    participantId: proxyAttribute,

    rsvp: function ( rsvp ) {
        var original = this.get( 'original' );
        var recurrenceOverrides = original.get( 'recurrenceOverrides' );
        var id = this.id;
        // If this is an exception from the organizer, RSVP to just this
        // instance, otherwise RSVP to whole series
        if ( recurrenceOverrides && recurrenceOverrides[ id ] &&
                Object.keys( recurrenceOverrides[ id ] ).some(
                function ( key ) {
                    return key !== 'alerts' && key !== 'useDefaultAlerts';
                })) {
            return CalendarEvent.prototype.rsvp.call( this, rsvp );
        }
        if ( rsvp !== undefined ) {
            original.set( 'rsvp', rsvp );
        }
        return original.get( 'rsvp' );
    }.property( 'participants', 'participantId' ),

    // ---

    useDefaultAlerts: proxyOverrideAttibute( Boolean, 'useDefaultAlerts' ),
    alerts: proxyOverrideAttibute( Object, 'alerts' ),
});

meta( CalendarEventOccurrence.prototype ).attrs =
    meta( CalendarEvent.prototype ).attrs;

// --- Export

JMAP.CalendarEventOccurrence = CalendarEventOccurrence;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: InfiniteDateSource.js                                                \\
// Module: CalendarModel                                                      \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const InfiniteDateSource = O.Class({

    Extends: O.ObservableArray,

    init: function ( mixin ) {
        InfiniteDateSource.parent.constructor.call( this, null, mixin );
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
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const mixin = O.mixin;
const Class = O.Class;
const Obj = O.Object;
const ObservableArray = O.ObservableArray;
const NestedStore = O.NestedStore;
const StoreUndoManager = O.StoreUndoManager;

const auth = JMAP.auth;
const store = JMAP.store;
const Calendar = JMAP.Calendar;
const CalendarEvent = JMAP.CalendarEvent;

// ---

const nonRepeatingEvents = new Obj({

    index: null,

    clearIndex: function () {
        this.index = null;
    },

    buildIndex: function () {
        var index = this.index = {};
        var timeZone = JMAP.calendar.get( 'timeZone' );
        var storeKeys = store.findAll( CalendarEvent, function ( data ) {
            return !data.recurrenceRule && !data.recurrenceOverrides;
        });
        var i = 0;
        var l = storeKeys.length;
        var event, timestamp, end, events;
        for ( ; i < l; i += 1 ) {
            event = store.materialiseRecord( storeKeys[i], CalendarEvent );
            timestamp = +event.getStartInTimeZone( timeZone );
            timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
            end = +event.getEndInTimeZone( timeZone );
            do {
                events = index[ timestamp ] || ( index[ timestamp ] = [] );
                events.push( event );
                timestamp += ( 24 * 60 * 60 * 1000 );
            } while ( timestamp < end );
        }
        return this;
    },

    getEventsForDate: function ( date ) {
        var timestamp = +date;
        timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
        if ( !this.index ) {
            this.buildIndex();
        }
        return this.index[ timestamp ] || null;
    },
});

const repeatingEvents = new Obj({

    start: null,
    end: null,
    index: null,

    records: function () {
        var storeKeys = store.findAll( CalendarEvent, function ( data ) {
            return !!data.recurrenceRule || !!data.recurrenceOverrides;
        });
        var i = 0;
        var l = storeKeys.length;
        var records = new Array( l );
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
        var startIndexStamp = +start;
        var endIndexStamp = +end;
        var index = this.index = {};
        var timeZone = JMAP.calendar.get( 'timeZone' );
        var records = this.get( 'records' );
        var i = 0;
        var l = records.length;
        var event, occurs, j, ll, occurrence, timestamp, endStamp, events;

        while ( i < l ) {
            event = records[i];
            occurs = event
                .getOccurrencesThatMayBeInDateRange( start, end, timeZone );
            for ( j = 0, ll = occurs ? occurs.length : 0; j < ll; j += 1 ) {
                occurrence = occurs[j];
                timestamp = +occurrence.getStartInTimeZone( timeZone );
                timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
                timestamp = Math.max( startIndexStamp, timestamp );
                endStamp = +occurrence.getEndInTimeZone( timeZone );
                endStamp = Math.min( endIndexStamp, endStamp );
                do {
                    events = index[ timestamp ] || ( index[ timestamp ] = [] );
                    events.push( occurrence );
                    timestamp += ( 24 * 60 * 60 * 1000 );
                } while ( timestamp < endStamp );
            }
            i += 1;
        }
        return this;
    },

    getEventsForDate: function ( date ) {
        var timestamp = +date;
        timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
        if ( !this.index || date < this.start || date >= this.end ) {
            this.buildIndex( date );
        }
        return this.index[ timestamp ] || null;
    },
});

// ---

/*
    If time zone is null -> consider each event in its native time zone.
    Otherwise, consider each event in the time zone given.

    date     - {Date} The date.
*/
const NO_EVENTS = [];
const eventSources = [ nonRepeatingEvents, repeatingEvents ];
const sortByStartInTimeZone = function ( timeZone ) {
    return function ( a, b ) {
        var aStart = a.getStartInTimeZone( timeZone ),
            bStart = b.getStartInTimeZone( timeZone );
        return aStart < bStart ? -1 : aStart > bStart ? 1 : 0;
    };
};

const getEventsForDate = function ( date, timeZone, allDay ) {
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
                ( showDeclined || event.get( 'rsvp' ) !== 'declined' ) &&
                ( !allDay || event.get( 'isAllDay' ) === ( allDay > 0 ) );
        });

        // And sort
        results.sort( sortByStartInTimeZone( timeZone ) );
    }

    return results || NO_EVENTS;
};

// ---

const eventsLists = [];

const EventsList = Class({

    Extends: ObservableArray,

    init: function ( date, allDay ) {
        this.date = date;
        this.allDay = allDay;

        eventsLists.push( this );

        EventsList.parent.constructor.call( this,
            getEventsForDate( date, JMAP.calendar.get( 'timeZone' ), allDay ));
    },

    destroy: function () {
        eventsLists.erase( this );
        EventsList.parent.destroy.call( this );
    },

    recalculate: function () {
        return this.set( '[]', getEventsForDate(
            this.date, JMAP.calendar.get( 'timeZone' ), this.allDay ));
    },
});

// ---

const toUTCDay = function ( date ) {
    return new Date( date - ( date % ( 24 * 60 * 60 * 1000 ) ) );
};

const twelveWeeks = 12 * 7 * 24 * 60 * 60 * 1000;
const now = new Date();
const usedTimeZones = {};
var editStore;

mixin( JMAP.calendar, {

    editStore: editStore = new NestedStore( store ),

    undoManager: new StoreUndoManager({
        store: editStore,
        maxUndoCount: 10
    }),

    eventSources: eventSources,
    repeatingEvents: repeatingEvents,
    nonRepeatingEvents: nonRepeatingEvents,

    showDeclined: false,
    timeZone: null,
    usedTimeZones: usedTimeZones,

    loadingEventsStart: now,
    loadingEventsEnd: now,
    loadedEventsStart: now,
    loadedEventsEnd: now,

    // allDay -> 0 (either), 1 (yes), -1 (no)
    getEventsForDate: function ( date, allDay ) {
        this.loadEvents( date );
        return new EventsList( date, allDay );
    },

    fetchEventsInRangeForAccount: function ( accountId, after, before ) {
        this.callMethod( 'CalendarEvent/query', {
            accountId: accountId,
            filter: {
                after: after.toJSON() + 'Z',
                before: before.toJSON() + 'Z',
            },
        });
        this.callMethod( 'CalendarEvent/get', {
            accountId: accountId,
            '#ids': {
                resultOf: this.getPreviousMethodId(),
                name: 'CalendarEvent/query',
                path: '/ids',
            },
        });
    },

    fetchEventsInRange: function ( after, before, callback ) {
        var accounts = auth.get( 'accounts' );
        var accountId, hasDataFor;
        for ( accountId in accounts ) {
            hasDataFor = accounts[ accountId ].hasDataFor;
            if ( !hasDataFor || hasDataFor.contains( 'calendars' ) ) {
                this.fetchEventsInRangeForAccount( accountId, after, before );
            }
        }
        if ( callback ) {
            this.addCallback( callback );
        }
        return this;
    },

    loadEvents: function ( date ) {
        var loadingEventsStart = this.loadingEventsStart;
        var loadingEventsEnd = this.loadingEventsEnd;
        var start, end;
        if ( loadingEventsStart === loadingEventsEnd ) {
            start = toUTCDay( date ).subtract( 16, 'week' );
            end = toUTCDay( date ).add( 48, 'week' );
            this.fetchEventsInRange( start, end, function () {
                JMAP.calendar
                    .set( 'loadedEventsStart', start )
                    .set( 'loadedEventsEnd', end );
            });
            this.set( 'loadingEventsStart', start );
            this.set( 'loadingEventsEnd', end );
            return;
        }
        if ( date < +loadingEventsStart + twelveWeeks ) {
            start = toUTCDay( date < loadingEventsStart ?
                date : loadingEventsStart
            ).subtract( 24, 'week' );
            this.fetchEventsInRange( start, loadingEventsStart, function () {
                JMAP.calendar.set( 'loadedEventsStart', start );
            });
            this.set( 'loadingEventsStart', start );
        }
        if ( date > +loadingEventsEnd - twelveWeeks ) {
            end = toUTCDay( date > loadingEventsEnd ?
                date : loadingEventsEnd
            ).add( 24, 'week' );
            this.fetchEventsInRange( loadingEventsEnd, end, function () {
                JMAP.calendar.set( 'loadedEventsEnd', end );
            });
            this.set( 'loadingEventsEnd', end );
        }
    },

    clearIndexes: function () {
        nonRepeatingEvents.clearIndex();
        repeatingEvents.clearIndex();
        this.recalculate();
    }.observes( 'timeZone' ),

    recalculate: function () {
        eventsLists.forEach( function ( eventsList ) {
            eventsList.recalculate();
        });
    }.queue( 'before' ).observes( 'showDeclined' ),

    flushCache: function ( accountId ) {
        this.replaceEvents[ accountId ] = true;
        this.fetchEventsInRangeForAccount( accountId,
            this.loadedEventsStart, this.loadedEventsEnd );
    },

    seenTimeZone: function ( timeZone ) {
        if ( timeZone ) {
            var timeZoneId = timeZone.id;
            usedTimeZones[ timeZoneId ] =
                ( usedTimeZones[ timeZoneId ] || 0 ) + 1;
        }
        return this;
    },
});
store.on( Calendar, JMAP.calendar, 'recalculate' )
     .on( CalendarEvent, JMAP.calendar, 'clearIndexes' );

JMAP.calendar.handle( null, {
    'CalendarEvent/query': function () {
        // We don't care about the list, we only use it to fetch the
        // events we want. This may change with search in the future!
    },
});

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: AmbiguousDate.js                                                     \\
// Module: ContactsModel                                                      \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const AmbiguousDate = O.Class({

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
});

AmbiguousDate.fromJSON = function ( json ) {
    var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec( json || '' );
    return parts ?
        new AmbiguousDate( +parts[3], +parts[2], +parts[1] ) : null;
};

JMAP.AmbiguousDate = AmbiguousDate;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Contact.js                                                           \\
// Module: ContactsModel                                                      \\
// Requires: API, AmbiguousDate.js                                            \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;
const sortByProperties = O.sortByProperties;

const auth = JMAP.auth;
const contacts = JMAP.contacts;
const AmbiguousDate = JMAP.AmbiguousDate;

// ---

const Contact = Class({

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

    birthday: attr( AmbiguousDate, {
        defaultValue: new AmbiguousDate( 0, 0, 0 )
    }),
    anniversary: attr( AmbiguousDate, {
        defaultValue: new AmbiguousDate( 0, 0, 0 )
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

    isEditable: function () {
        var accountId = this.get( 'accountId' );
        return !accountId ||
            !auth.get( 'accounts' )[ accountId ].isReadOnly;
    }.property( 'accountId' ),

    // ---

    groups: function () {
        var contact = this;
        return contact
            .get( 'store' )
            .getAll( JMAP.ContactGroup, null, sortByProperties([ 'name' ]) )
            .filter( function ( group ) {
                return group.contains( contact );
           });
    }.property(),

    groupsDidChange: function () {
        this.computedPropertyDidChange( 'groups' );
    },

    // ---

    init: function () {
        Contact.parent.init.apply( this, arguments );
        this.get( 'store' ).on( JMAP.ContactGroup, this, 'groupsDidChange' );
    },

    storeWillUnload: function () {
        this.get( 'store' ).off( JMAP.ContactGroup, this, 'groupsDidChange' );
        Contact.parent.storeWillUnload.call( this );
    },

    // Destroy dependent records.
    destroy: function () {
        this.get( 'groups' ).forEach( function ( group ) {
            group.get( 'contacts' ).remove( this );
        }, this );
        Contact.parent.destroy.call( this );
    },

    // ---

    name: function () {
        var name = (
                this.get( 'firstName' ) + ' ' + this.get( 'lastName' )
            ).trim();
        if ( !name ) {
            name = this.get( 'company' );
        }
        return name;
    }.property( 'firstName', 'lastName', 'company' ),

    emailName: function () {
        var name = this.get( 'name' ).replace( /["\\]/g, '' );
        if ( /[,;<>@()]/.test( name ) ) {
            name = '"' + name + '"';
        }
        return name;
    }.property( 'name' ),

    defaultEmailIndex: function () {
        var emails = this.get( 'emails' );
        var i, l;
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
        var name = this.get( 'emailName' );
        var email = this.get( 'defaultEmail' );
        return email ? name ? name + ' <' + email + '>' : email : '';
    }.property( 'emailName', 'defaultEmail' )
});
Contact.__guid__ = 'Contact';
Contact.dataGroup = 'contacts';

// ---

contacts.handle( Contact, {

    precedence: 0, // Before ContactGroup

    fetch: function ( accountId, ids ) {
        this.callMethod( 'Contact/get', {
            accountId: accountId,
            ids: ids || null,
        });
    },

    refresh: function ( accountId, ids, state ) {
        if ( ids ) {
            this.callMethod( 'Contact/get', {
                accountId: accountId,
                ids: ids,
            });
        } else {
            this.callMethod( 'Contact/changes', {
                accountId: accountId,
                sinceState: state,
                maxChanges: 100,
            });
            this.callMethod( 'Contact/get', {
                accountId: accountId,
                '#ids': {
                    resultOf: this.getPreviousMethodId(),
                    name: 'Contact/changes',
                    path: '/changed',
                },
            });
        }
    },

    commit: 'Contact/set',

    // ---

    'Contact/get': function ( args, reqMethod, reqArgs ) {
        const isAll = ( reqArgs.ids === null );
        this.didFetch( Contact, args, isAll );
    },

    'Contact/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( Contact, args, hasDataForChanged );
        if ( args.hasMoreChanges ) {
            this.get( 'store' ).fetchAll( Contact, true );
        }
    },

    'Contact/copy': function ( args ) {
        this.didCopy( Contact, args );
    },

    'error_Contact/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( accountId, Contact );
    },

    'Contact/set': function ( args ) {
        this.didCommit( Contact, args );
    },
});

// --- Export

JMAP.Contact = Contact;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: ContactGroup.js                                                      \\
// Module: ContactsModel                                                      \\
// Requires: API, Contact.js                                                  \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const loc = O.loc;
const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;
const ValidationError = O.ValidationError;
const REQUIRED = ValidationError.REQUIRED;

const auth = JMAP.auth;
const contacts = JMAP.contacts;
const Contact = JMAP.Contact;

// ---

const ContactGroup = Class({

    Extends: Record,

    isEditable: function () {
        var accountId = this.get( 'accountId' );
        return !accountId ||
            !auth.get( 'accounts' )[ accountId ].isReadOnly;
    }.property( 'accountId' ),

    name: attr( String, {
        defaultValue: '',
        validate: function ( propValue/*, propKey, record*/ ) {
            if ( !propValue ) {
                return new ValidationError( REQUIRED,
                    loc( 'S_LABEL_REQUIRED' )
                );
            }
            return null;
        },
    }),

    contacts: Record.toMany({
        recordType: Contact,
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
        },
    }),

    contactIndex: function () {
        var storeKeys = this.contacts.getRaw( this, 'contacts' );
        var index = {};
        var i, l;
        for ( i = 0, l = storeKeys.length; i < l; i += 1 ) {
            index[ storeKeys[i] ] = true;
        }
        return index;
    }.property( 'contacts' ),

    contains: function ( contact ) {
        return !!this.get( 'contactIndex' )[ contact.get( 'storeKey' ) ];
    },
});
ContactGroup.__guid__ = 'ContactGroup';
ContactGroup.dataGroup = 'contacts';

// ---

contacts.handle( ContactGroup, {

    precedence: 1, // After Contact

    fetch: function ( accountId, ids ) {
        this.callMethod( 'ContactGroup/get', {
            accountId: accountId,
            ids: ids || null,
        });
    },

    refresh: function ( accountId, ids, state ) {
        if ( ids ) {
            this.callMethod( 'ContactGroup/get', {
                accountId: accountId,
                ids: ids,
            });
        } else {
            this.callMethod( 'ContactGroup/changes', {
                accountId: accountId,
                sinceState: state,
                maxChanges: 100,
            });
            this.callMethod( 'ContactGroup/get', {
                accountId: accountId,
                '#ids': {
                    resultOf: this.getPreviousMethodId(),
                    name: 'ContactGroup/changes',
                    path: '/changed',
                },
            });
        }
    },

    commit: 'ContactGroup/set',

    // ---

    'ContactGroup/get': function ( args, _, reqArgs ) {
        const isAll = ( reqArgs.ids === null );
        this.didFetch( ContactGroup, args, isAll );
    },

    'ContactGroup/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( ContactGroup, args, hasDataForChanged );
    },

    'error_ContactGroup/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( accountId, ContactGroup );
    },

    'ContactGroup/set': function ( args ) {
        this.didCommit( ContactGroup, args );
    },
});

// --- Export

JMAP.ContactGroup = ContactGroup;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: contacts-model.js                                                    \\
// Module: ContactsModel                                                      \\
// Requires: API, Contact.js                                                  \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const Obj = O.Object;
const NestedStore = O.NestedStore;
const StoreUndoManager = O.StoreUndoManager;

const Contact = JMAP.Contact;
const store = JMAP.store;
const contacts = JMAP.contacts;

// ---

const contactsIndex = new Obj({
    index: null,
    clearIndex: function () {
        this.index = null;
    },
    buildIndex: function () {
        var index = this.index = {};
        var storeKeys = store.findAll( Contact );
        var i, l, contact, emails, ll;
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
    },
});
store.on( Contact, contactsIndex, 'clearIndex' );

// ---

const editStore = new NestedStore( store );

Object.assign( contacts, {
    editStore: editStore,

    undoManager: new StoreUndoManager({
        store: editStore,
        maxUndoCount: 10,
    }),

    getContactFromEmail: function ( email ) {
        var index = contactsIndex.getIndex();
        return index[ email.toLowerCase() ] || null;
    },
});

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Identity.js                                                          \\
// Module: MailModel                                                          \\
// Requires: API                                                              \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;

// ---

const Identity = Class({

    Extends: Record,

    name: attr( String, {
        defaultValue: '',
    }),

    email: attr( String ),

    replyTo: attr( String, {
        defaultValue: '',
    }),

    bcc: attr( String, {
        defaultValue: '',
    }),

    textSignature: attr( String, {
        key: 'textSignature',
        defaultValue: ''
    }),

    htmlSignature: attr( String, {
        key: 'htmlSignature',
        defaultValue: ''
    }),

    mayDelete: attr( Boolean, {
        defaultValue: true
    }),

    // ---

    nameAndEmail: function () {
        var name = this.get( 'name' ).replace( /["\\]/g, '' );
        var email = this.get( 'email' );
        if ( name ) {
            if ( /[,;<>@()]/.test( name ) ) {
                name = '"' + name + '"';
            }
            return name + ' <' + email + '>';
        }
        return email;
    }.property( 'name', 'email' ),
});
Identity.dataGroup = 'mail';

JMAP.mail.handle( Identity, {

    precedence: 2,

    fetch: function ( accountId, ids ) {
        this.callMethod( 'Identity/get', {
            accountId: accountId,
            ids: ids || null,
        });
    },

    refresh: function ( accountId, ids, state ) {
        if ( ids ) {
            this.callMethod( 'Identity/get', {
                accountId: accountId,
                ids: ids,
            });
        } else {
            this.callMethod( 'Identity/changes', {
                accountId: accountId,
                sinceState: state,
                maxChanges: 100,
            });
            this.callMethod( 'Identity/get', {
                accountId: accountId,
                '#ids': {
                    resultOf: this.getPreviousMethodId(),
                    name: 'Identity/changes',
                    path: '/changed',
                },
            });
        }
    },

    commit: 'Identity/set',

    // ---

    'Identity/get': function ( args, reqMethod, reqArgs ) {
        const isAll = ( reqArgs.ids === null );
        this.didFetch( Identity, args, isAll );
    },

    'Identity/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( Identity, args, hasDataForChanged );
        if ( args.hasMoreChanges ) {
            this.get( 'store' ).fetchAll( Identity, true );
        }
    },

    'error_Identity/changes_cannotCalculateChanges': function () {
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( Identity );
    },

    'Identity/set': function ( args ) {
        this.didCommit( Identity, args );
    },
});

// --- Export

JMAP.Identity = Identity;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Mailbox.js                                                           \\
// Module: MailModel                                                          \\
// Requires: API                                                              \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const loc = O.loc;
const sortByProperties = O.sortByProperties;
const Class = O.Class;
const RecordArray = O.RecordArray;
const LocalQuery = O.LocalQuery;
const Record = O.Record;
const attr = Record.attr;
const ValidationError = O.ValidationError;
const REQUIRED = ValidationError.REQUIRED;
const TOO_LONG = ValidationError.TOO_LONG;

// ---

const Mailbox = Class({

    Extends: Record,

    name: attr( String, {
        defaultValue: '',
        validate: function ( propValue/*, propKey, record*/ ) {
            if ( !propValue ) {
                return new ValidationError( REQUIRED,
                    loc( 'S_LABEL_REQUIRED' )
                );
            }
            if ( propValue.length > 256 ) {
                return new ValidationError( TOO_LONG,
                    loc( 'S_MAIL_ERROR_MAX_CHARS', 256 )
                );
            }
            return null;
        }
    }),

    parent: Record.toOne({
        // Type: Mailbox,
        key: 'parentId',
        defaultValue: null,
        willSet: function ( propValue, propKey, record ) {
            if ( propValue ) {
                record.set( 'accountId', propValue.get( 'accountId' ) );
            }
            return true;
        },
    }),

    role: attr( String, {
        defaultValue: null
    }),

    sortOrder: attr( Number, {
        defaultValue: 10
    }),

    // ---

    myRights: attr( Boolean, {
        defaultValue: {
            mayReadItems: true,
            mayAddItems: true,
            mayRemoveItems: true,
            maySetSeen: true,
            maySetKeywords: true,
            mayCreateChild: true,
            mayRename: true,
            mayDelete: true,
            maySubmit: true,
        },
        noSync: true
    }),

    // ---

    totalEmails: attr( Number, {
        defaultValue: 0,
        noSync: true
    }),
    unreadEmails: attr( Number, {
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
        var storeKey = this.get( 'storeKey' );
        var store = this.get( 'store' );
        var accountId = this.get( 'accountId' );
        return storeKey ?
            store.getAll( Mailbox,
                function ( data ) {
                    return data.accountId === accountId &&
                        data.parentId === storeKey;
                },
                sortByProperties([ 'sortOrder', 'name' ])
            ) :
            new RecordArray( store, Mailbox, [] );
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
        var sub = ( where === 'sub' );
        var parent = sub ? dest : dest.get( 'parent' );
        var accountId = dest.get( 'accountId' );
        var siblings = parent ?
                parent.get( 'subfolders' ) :
                this.get( 'store' ).getQuery( 'rootMailboxes-' + accountId,
                LocalQuery, {
                    Type: Mailbox,
                    where: function ( data ) {
                        return data.accountId === accountId && !data.parentId;
                    },
                    sort: [ 'sortOrder', 'name' ],
                });
        var index = sub ? 0 :
                siblings.indexOf( dest ) + ( where === 'next' ? 1 : 0 );
        var prev = index ? siblings.getObjectAt( index - 1 ) : null;
        var next = siblings.getObjectAt( index );
        var prevSortOrder = prev ? prev.get( 'sortOrder' ) : 0;
        var nextSortOrder = next ? next.get( 'sortOrder' ) : ( index + 2 ) * 32;
        var i, p, l, folder;

        if ( nextSortOrder - prevSortOrder < 2 ) {
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
            if ( prev ) { prevSortOrder = prev.get( 'sortOrder' ); }
            if ( next ) { nextSortOrder = next.get( 'sortOrder' ); }
        }
        this.set( 'parent', parent || null )
            .set( 'sortOrder', ( nextSortOrder + prevSortOrder ) >> 1 );
    },

    // ---

    destroy: function () {
        // Check ACL
        if ( this.get( 'myRights' ).mayDelete ) {
            // Destroy dependent records
            this.get( 'subfolders' ).forEach( function ( folder ) {
                folder.destroy();
            });
            Mailbox.parent.destroy.call( this );
        }
    },
});
Mailbox.__guid__ = 'Mailbox';
Mailbox.dataGroup = 'mail';

Mailbox.prototype.parent.Type = Mailbox;

JMAP.mail.handle( Mailbox, {

    precedence: 0,

    fetch: function ( accountId, ids ) {
        this.callMethod( 'Mailbox/get', {
            accountId: accountId,
            ids: ids || null,
        });
    },

    refresh: function ( accountId, ids, state ) {
        if ( ids ) {
            this.callMethod( 'Mailbox/get', {
                accountId: accountId,
                ids: ids,
                properties: [
                    'totalEmails', 'unreadEmails',
                    'totalThreads', 'unreadThreads',
                ],
            });
        } else {
            this.callMethod( 'Mailbox/changes', {
                accountId: accountId,
                sinceState: state,
            });
            this.callMethod( 'Mailbox/get', {
                accountId: accountId,
                '#ids': {
                    resultOf: this.getPreviousMethodId(),
                    name: 'Mailbox/changes',
                    path: '/changed',
                },
                '#properties': {
                    resultOf: this.getPreviousMethodId(),
                    name: 'Mailbox/changes',
                    path: '/changedProperties',
                },
            });
        }
    },

    commit: 'Mailbox/set',

    // ---

    'Mailbox/get': function ( args, _, reqArgs ) {
        const isAll = ( reqArgs.ids === null );
        this.didFetch( Mailbox, args, isAll );
    },

    'Mailbox/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( Mailbox, args, hasDataForChanged );
        if ( args.hasMoreChanges ) {
            this.get( 'store' ).fetchAll( args.accountId, Mailbox, true );
        }
    },

    'error_Mailbox/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( accountId, Mailbox );
    },

    'Mailbox/set': function ( args ) {
        this.didCommit( Mailbox, args );
    },
});

// --- Export

JMAP.Mailbox = Mailbox;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Message.js                                                           \\
// Module: MailModel                                                          \\
// Requires: API, Mailbox.js                                                  \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP, undefined ) {

const clone = O.clone;
const guid = O.guid;
const i18n = O.i18n;
const Class = O.Class;
const Status = O.Status;
const EMPTY = Status.EMPTY;
const READY = Status.READY;
const LOADING = Status.LOADING;
const NEW = Status.NEW;
const Record = O.Record;
const attr = Record.attr;

const Mailbox = JMAP.Mailbox;
const mail = JMAP.mail;

// ---

const myRightsProperty = function ( permission ) {
    return function () {
        return this.get( 'mailboxes' ).every( function ( mailbox ) {
            return mailbox.get( 'myRights' )[ permission ];
        });
    }.property().nocache();
};

const keywordProperty = function ( keyword ) {
    return function ( value ) {
        if ( value !== undefined ) {
            this.setKeyword( keyword, value );
        } else {
            value = this.get( 'keywords' )[ keyword ];
        }
        return !!value;
    }.property( 'keywords' );
};

const MessageDetails = Class({ Extends: Record });
const MessageThread = Class({ Extends: Record });

const Message = Class({

    Extends: Record,

    thread: Record.toOne({
        // Type: JMAP.Thread,
        key: 'threadId',
        noSync: true,
    }),

    mailboxes: Record.toMany({
        recordType: Mailbox,
        key: 'mailboxIds',
        Type: Object,
    }),

    keywords: attr( Object, {
        defaultValue: {}
    }),

    hasAttachment: attr( Boolean ),

    from: attr( Array ),
    to: attr( Array ),
    subject: attr( String ),

    receivedAt: attr( Date, {
        toJSON: Date.toUTCJSON,
    }),

    size: attr( Number ),

    preview: attr( String ),

    // ---

    hasPermission: function ( permission ) {
        return this.get( 'mailboxes' ).every( function ( mailbox ) {
            return mailbox.get( 'myRights' )[ permission ];
        });
    },

    isIn: function ( role ) {
        return this.get( 'mailboxes' ).some( function ( mailbox ) {
            return mailbox.get( 'role' ) === role;
        });
    },

    isInTrash: function () {
        return this.isIn( 'trash' );
    }.property( 'mailboxes' ),

    isInNotTrash: function () {
        return !this.get( 'isInTrash' ) ||
            ( this.get( 'mailboxes' ).get( 'length' ) > 1 );
    }.property( 'mailboxes' ),

    notifyThread: function () {
        var store = this.get( 'store' );
        var threadSK = this.getData().threadId;
        if ( store.getStatus( threadSK ) & READY ) {
            this.get( 'thread' ).propertyDidChange( 'messages' );
        }
    }.queue( 'before' ).observes( 'mailboxes', 'keywords', 'hasAttachment' ),

    // ---

    isUnread: function ( value ) {
        if ( value !== undefined ) {
            this.setKeyword( '$seen', !value );
        } else {
            value = !this.get( 'keywords' ).$seen;
        }
        return value;
    }.property( 'keywords' ),

    isDraft: keywordProperty( '$draft' ),
    isFlagged: keywordProperty( '$flagged' ),
    isAnswered: keywordProperty( '$answered' ),
    isForwarded: keywordProperty( '$forwarded' ),
    isPhishing: keywordProperty( '$phishing' ),

    setKeyword: function ( keyword, value ) {
        var keywords = clone( this.get( 'keywords' ) );
        if ( value ) {
            keywords[ keyword ] = true;
        } else {
            delete keywords[ keyword ];
        }
        return this.set( 'keywords', keywords );
    },

    // ---

    fromName: function () {
        var from = this.get( 'from' );
        var emailer = from && from [0] || null;
        return emailer ? emailer.name || emailer.email.split( '@' )[0] : '';
    }.property( 'from' ),

    fromEmail: function () {
        var from = this.get( 'from' );
        var emailer = from && from [0] || null;
        return emailer ? emailer.email : '';
    }.property( 'from' ),

    // ---

    fullDate: function () {
        var date = this.get( 'receivedAt' );
        return i18n.date( date, 'fullDateAndTime' );
    }.property( 'receivedAt' ),

    relativeDate: function () {
        var date = this.get( 'receivedAt' );
        return date.relativeTo( null, true, true );
    }.property().nocache(),

    formattedSize: function () {
        return i18n.fileSize( this.get( 'size' ), 1 );
    }.property( 'size' ),

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
            mail.fetchRecord(
                this.get( 'accountId' ), MessageDetails, this.get( 'id' ) );
            this.set( 'detailsStatus', EMPTY|LOADING );
        }
    },

    blobId: attr( String, {
        noSync: true,
    }),

    headers: attr( Object, {
        defaultValue: {}
    }),

    sender: attr( Object ),
    cc: attr( Array ),
    bcc: attr( Array ),
    replyTo: attr( Array ),
    sentAt: attr( Date ),

    textBody: attr( String ),
    htmlBody: attr( String ),

    attachments: attr( Array ),
    attachedEmails: attr( Object ),
});
Message.__guid__ = 'Email';
Message.dataGroup = 'mail';

Message.headerProperties = [
    'threadId',
    'mailboxIds',
    'keywords',
    'hasAttachment',
    'from',
    'to',
    'subject',
    'receivedAt',
    'size',
    'preview',
];
Message.detailsProperties = [
    'blobId',
    'headers.message-id',
    'headers.in-reply-to',
    'headers.references',
    'headers.list-id',
    'headers.list-post',
    'sender',
    'cc',
    'bcc',
    'replyTo',
    'sentAt',
    'body',
    'attachments',
    'attachedEmails',
];
Message.Details = MessageDetails;
Message.Thread = MessageThread;

// ---

mail.handle( MessageDetails, {
    fetch: function ( accountId, ids ) {
        this.callMethod( 'Email/get', {
            accountId: accountId,
            ids: ids,
            properties: Message.detailsProperties,
        });
    },
});

// ---

mail.handle( MessageThread, {
    fetch: function ( accountId, ids ) {
        this.callMethod( 'Email/get', {
            accountId: accountId,
            ids: ids,
            properties: [ 'threadId' ],
        });
        this.callMethod( 'Thread/get', {
            accountId: accountId,
            '#ids': {
                resultOf: this.getPreviousMethodId(),
                name: 'Email/get',
                path: '/list/*/threadId',
            },
        });
        this.callMethod( 'Email/get', {
            accountId: accountId,
            '#ids': {
                resultOf: this.getPreviousMethodId(),
                name: 'Thread/get',
                path: '/list/*/emailIds',
            },
            properties: Message.headerProperties
        });
    },
});

// ---

mail.messageChangesFetchRecords = true;
mail.messageChangesMaxChanges = 50;
mail.handle( Message, {

    precedence: 1,

    fetch: function ( accountId, ids ) {
        // Called with ids == null if you try to refresh before we have any
        // data loaded. Just ignore.
        if ( ids ) {
            this.callMethod( 'Email/get', {
                accountId: accountId,
                ids: ids,
                properties: Message.headerProperties
            });
        }
    },

    refresh: function ( accountId, ids, state ) {
        if ( ids ) {
            this.callMethod( 'Email/get', {
                accountId: accountId,
                ids: ids,
                properties: [
                    'mailboxIds',
                    'keywords',
                ]
            });
        } else {
            this.callMethod( 'Email/changes', {
                accountId: accountId,
                sinceState: state,
                maxChanges: this.messageChangesMaxChanges,
            });
            if ( this.messageChangesFetchRecords ) {
                this.callMethod( 'Email/get', {
                    accountId: accountId,
                    '#ids': {
                        resultOf: this.getPreviousMethodId(),
                        name: 'Email/changes',
                        path: '/changed',
                    },
                    properties: Message.headerProperties,
                });
            }
        }
    },

    commit: 'Email/set',

    // ---

    'Email/get': function ( args, _, reqArgs ) {
        var store = this.get( 'store' );
        var list = args.list;
        var accountId = args.accountId;
        var updates, l, message, data, headers;

        // Merge with any previous fetched headers. This is safe, because
        // the headers are immutable.
        l = list.length;
        while ( l-- ) {
            message = list[l];
            if ( message.headers ) {
                data = store.getData(
                    store.getStoreKey( accountId, Message, message.id )
                );
                headers = data && data.headers;
                if ( headers ) {
                    Object.assign( message.headers, headers );
                }
            }
        }

        if ( !message || message.receivedAt ) {
            this.didFetch( Message, args );
        } else if ( !reqArgs.properties || reqArgs.properties.length > 1 ) {
            updates = args.list.reduce( function ( updates, message ) {
                updates[ message.id ] = message;
                return updates;
            }, {} );
            store.sourceDidFetchPartialRecords( accountId, Message, updates );
        }
    },

    'Email/changes': function ( args ) {
        const hasDataForChanged = this.messageChangesFetchRecords;
        this.didFetchUpdates( Message, args, hasDataForChanged );
        if ( !hasDataForChanged ) {
            this.recalculateAllFetchedWindows();
        }
        if ( args.hasMoreChanges ) {
            var messageChangesMaxChanges = this.messageChangesMaxChanges;
            if ( messageChangesMaxChanges < 150 ) {
                if ( messageChangesMaxChanges === 50 ) {
                    // Keep fetching updates, just without records
                    this.messageChangesFetchRecords = false;
                    this.messageChangesMaxChanges = 100;
                } else {
                    this.messageChangesMaxChanges = 150;
                }
                this.get( 'store' ).fetchAll( args.accountId, Message, true );
                return;
            } else {
                // We've fetched 300 updates and there's still more. Let's give
                // up and reset.
                this.response[ 'error_Email/changes_cannotCalculateChanges' ]
                    .call( this, args );
            }
        }
        this.messageChangesFetchRecords = true;
        this.messageChangesMaxChanges = 50;
    },

    'error_Email/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var store = this.get( 'store' );
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Mark all messages as obsolete.
        // The garbage collector will eventually clean up any messages that
        // no longer exist
        store.getAll( Message ).forEach( function ( message ) {
            if ( message.get( 'accountId' ) === accountId ) {
                message.setObsolete();
            }
        });
        this.recalculateAllFetchedWindows();
        // Tell the store we're now in the new state.
        store.sourceDidFetchUpdates( accountId,
            Message, null, null, store.getTypeState( accountId, Message ), '' );
    },

    'Email/set': function ( args, reqName ) {
        // If we did a set implicitly on successful send, the change is not in
        // the store, so don't call didCommit; we've fetched the changes
        // as well, so we'll be up to date. We do need to invalidate all the
        // MessageList queries though.
        if ( reqName === 'EmailSubmission/set' ) {
            this.get( 'store' ).fire( guid( Message ) + ':server' );
            return;
        }
        this.didCommit( Message, args );
    },
});

// --- Export

JMAP.Message = Message;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Thread.js                                                            \\
// Module: MailModel                                                          \\
// Requires: API, Message.js                                                  \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const meta = O.meta;
const Class = O.Class;
const ObservableArray = O.ObservableArray;
const Record = O.Record;
const READY = O.Status.READY;

const Message = JMAP.Message;

// ---

const isInTrash = function ( message ) {
    return message.is( READY ) && message.get( 'isInTrash' );
};
const isInNotTrash = function ( message ) {
    return message.is( READY ) && message.get( 'isInNotTrash' );
};

const aggregateBoolean = function ( _, key ) {
    return this.get( 'messages' ).reduce(
    function ( isProperty, message ) {
        return isProperty || message.get( key );
    }, false );
}.property( 'messages' ).nocache();

const aggregateBooleanInNotTrash = function ( _, key ) {
    key = key.slice( 0, -10 );
    return this.get( 'messagesInNotTrash' ).reduce(
    function ( isProperty, message ) {
        return isProperty || message.get( key );
    }, false );
}.property( 'messages' ).nocache();

const aggregateBooleanInTrash = function ( _, key ) {
    key = key.slice( 0, -7 );
    return this.get( 'messagesInTrash' ).reduce(
    function ( isProperty, message ) {
        return isProperty || message.get( key );
    }, false );
}.property( 'messages' ).nocache();

const total = function( property ) {
    return function () {
        return this.get( property ).get( 'length' );
    }.property( 'messages' ).nocache();
};

// senders is [{name: String, email: String}]
const toFrom = function ( message ) {
    var from = message.get( 'from' );
    return from && from[0] || null;
};
const senders = function( property ) {
    return function () {
        return this.get( property )
                   .map( toFrom )
                   .filter( O.Transform.toBoolean );
    }.property( 'messages' ).nocache();
};

const sumSize = function ( size, message ) {
    return size + ( message.get( 'size' ) || 0 );
};
const size = function( property ) {
    return function () {
        return this.get( property ).reduce( sumSize, 0 );
    }.property( 'messages' ).nocache();
};

const Thread = Class({

    Extends: Record,

    isEditable: false,

    messages: Record.toMany({
        recordType: Message,
        key: 'emailIds',
    }),

    messagesInNotTrash: function () {
        return new ObservableArray(
            this.get( 'messages' ).filter( isInNotTrash )
        );
    }.property(),

    messagesInTrash: function () {
        return new ObservableArray(
            this.get( 'messages' ).filter( isInTrash )
         );
    }.property(),

    _setMessagesArrayContent: function () {
        var cache = meta( this ).cache;
        var messagesInNotTrash = cache.messagesInNotTrash;
        var messagesInTrash = cache.messagesInTrash;
        if ( messagesInNotTrash ) {
            messagesInNotTrash.set( '[]',
                this.get( 'messages' ).filter( isInNotTrash )
            );
        }
        if ( messagesInTrash ) {
            messagesInTrash.set( '[]',
                this.get( 'messages' ).filter( isInTrash )
            );
        }
    }.observes( 'messages' ),

    isAll: function ( status ) {
        return this.is( status ) &&
            // .reduce instead of .every so we deliberately fetch every record
            // object from the store, triggering a fetch if not loaded
            this.get( 'messages' ).reduce( function ( isStatus, message ) {
                return isStatus && message.is( status );
            }, true );
    },

    // Note: API Mail mutates this value; do not cache.
    mailboxCounts: function () {
        var counts = {};
        this.get( 'messages' ).forEach( function ( message ) {
            message.get( 'mailboxes' ).forEach( function ( mailbox ) {
                var storeKey = mailbox.get( 'storeKey' );
                counts[ storeKey ] = ( counts[ storeKey ] ||  0 ) + 1;
            });
        });
        return counts;
    }.property( 'messages' ).nocache(),

    // ---

    isUnread: aggregateBoolean,
    isFlagged: aggregateBoolean,
    isDraft: aggregateBoolean,
    hasAttachment: aggregateBoolean,

    total: total( 'messages' ),
    senders: senders( 'messages' ),
    size: size( 'messages' ),

    // ---

    isUnreadInNotTrash: aggregateBooleanInNotTrash,
    isFlaggedInNotTrash: aggregateBooleanInNotTrash,
    isDraftInNotTrash: aggregateBooleanInNotTrash,
    hasAttachmentInNotTrash: aggregateBooleanInNotTrash,

    totalInNotTrash: total( 'messagesInNotTrash' ),
    sendersInNotTrash: senders( 'messagesInNotTrash' ),
    sizeInNotTrash: size( 'messagesInNotTrash' ),

    // ---

    isUnreadInTrash: aggregateBooleanInTrash,
    isFlaggedInTrash: aggregateBooleanInTrash,
    isDraftInTrash: aggregateBooleanInTrash,
    hasAttachmentInTrash: aggregateBooleanInTrash,

    totalInTrash: total( 'messagesInTrash' ),
    sendersInTrash: senders( 'messagesInTrash' ),
    sizeInTrash: size( 'messagesInTrash' )
});
Thread.__guid__ = 'Thread';
Thread.dataGroup = 'mail';

JMAP.mail.threadChangesFetchRecords = true;
JMAP.mail.threadChangesMaxChanges = 30;
JMAP.mail.handle( Thread, {

    fetch: function ( accountId, ids ) {
        // Called with ids == null if you try to refresh before we have any
        // data loaded. Just ignore.
        if ( ids ) {
            this.callMethod( 'Thread/get', {
                accountId: accountId,
                ids: ids,
            });
            this.callMethod( 'Email/get', {
                accountId: accountId,
                '#ids': {
                    resultOf: this.getPreviousMethodId(),
                    name: 'Thread/get',
                    path: '/list/*/emailIds',
                },
                properties: Message.headerProperties,
            });
        }
    },

    refresh: function ( accountId, ids, state ) {
        if ( ids ) {
            this.callMethod( 'Thread/get', {
                accountId: accountId,
                ids: ids,
            });
        } else {
            this.callMethod( 'Thread/changes', {
                accountId: accountId,
                sinceState: state,
                maxChanges: this.threadChangesMaxChanges,
            });
            if ( this.threadChangesFetchRecords ) {
                this.callMethod( 'Thread/get', {
                    accountId: accountId,
                    '#ids': {
                        resultOf: this.getPreviousMethodId(),
                        name: 'Thread/changes',
                        path: '/changed',
                    },
                });
            }
        }
    },

    //  ---

    'Thread/get': function ( args ) {
        this.didFetch( Thread, args );
    },

    'Thread/changes': function ( args ) {
        const hasDataForChanged = this.threadChangesFetchRecords;
        this.didFetchUpdates( Thread, args, hasDataForChanged );
        if ( !hasDataForChanged ) {
            this.recalculateAllFetchedWindows();
        }
        if ( args.hasMoreChanges ) {
            const threadChangesMaxChanges = this.threadChangesMaxChanges;
            if ( threadChangesMaxChanges < 120 ) {
                if ( threadChangesMaxChanges === 30 ) {
                    // Keep fetching updates, just without records
                    this.threadChangesFetchRecords = false;
                    this.threadChangesMaxChanges = 100;
                } else {
                    this.threadChangesMaxChanges = 120;
                }
                this.get( 'store' ).fetchAll( args.accountId, Thread, true );
                return;
            } else {
                // We've fetched 250 updates and there's still more. Let's give
                // up and reset.
                this.response
                    .error_getThreadUpdates_cannotCalculateChanges
                    .call( this, args );
            }
        }
        this.threadChangesFetchRecords = true;
        this.threadChangesMaxChanges = 30;
    },

    'error_Thread/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var store = this.get( 'store' );
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Unload if possible, otherwise mark
        // obsolete.
        store.getAll( Thread ).forEach( function ( thread ) {
            if ( thread.get( 'accountId' ) === accountId ) {
                if ( !store.unloadRecord( thread.get( 'storeKey' ) ) ) {
                    thread.setObsolete();
                }
            }
        });
        this.recalculateAllFetchedWindows();
        // Tell the store we're now in the new state.
        store.sourceDidFetchUpdates(
            accountId, Thread, null, null,
            store.getTypeState( accountId, Thread ), ''
        );
    },
});

// ---

// Circular dependency
Message.prototype.thread.Type = Thread;

// --- Export

JMAP.Thread = Thread;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: MessageList.js                                                       \\
// Module: MailModel                                                          \\
// Requires: API, Message.js, Thread.js                                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP, undefined ) {

const Class = O.Class;
const WindowedQuery = O.WindowedQuery;
const isEqual = O.isEqual;
const Status = O.Status;
const EMPTY = Status.EMPTY;
const READY = Status.READY;
const OBSOLETE = Status.OBSOLETE;

const getQueryId = JMAP.getQueryId;
const Message = JMAP.Message;

// ---

const isFetched = function ( message ) {
    return !message.is( EMPTY|OBSOLETE );
};
const refresh = function ( record ) {
    if ( record.is( OBSOLETE ) ) {
        record.fetch();
    }
};

const EMPTY_SNIPPET = {
    body: ' ',
};

const getId = function ( args ) {
    return getQueryId( Message, args ) + ( args.collapseThreads ? '+' : '-' );
};

const MessageList = Class({

    Extends: WindowedQuery,

    optimiseFetching: true,

    sort: [{ property: 'receivedAt', isAscending: false }],
    collapseThreads: true,

    Type: Message,

    init: function ( options ) {
        this._snippets = {};
        this._snippetsNeeded = [];

        MessageList.parent.constructor.call( this, options );
    },

    // Precondition: All ids are fetched for the window to be checked.
    checkIfWindowIsFetched: function ( index ) {
        var store = this.get( 'store' );
        var windowSize = this.get( 'windowSize' );
        var storeKeys = this.getStoreKeys();
        var i = index * windowSize;
        var l = Math.min( i + windowSize, this.get( 'length' ) );
        var collapseThreads = this.get( 'collapseThreads' );
        var messageSK, threadSK, thread;
        for ( ; i < l; i += 1 ) {
            messageSK = storeKeys[i];
            // No message, or out-of-date
            if ( store.getStatus( messageSK ) & (EMPTY|OBSOLETE) ) {
                return false;
            }
            if ( collapseThreads ) {
                threadSK = store.getRecordFromStoreKey( messageSK )
                                .getData()
                                .threadId;
                // No thread, or out-of-date
                if ( store.getStatus( threadSK ) & (EMPTY|OBSOLETE) ) {
                    return false;
                }
                thread = store.getRecordFromStoreKey( threadSK );
                return thread.get( 'messages' ).every( isFetched );
            }
        }
        return true;
    },

    sourceWillFetchQuery: function () {
        var req = MessageList.parent.sourceWillFetchQuery.call( this );

        // If we have all the ids already, optimise the loading of the records.
        var store = this.get( 'store' );
        var storeKeys = this.getStoreKeys();
        var length = this.get( 'length' );
        var collapseThreads = this.get( 'collapseThreads' );

        req.records = req.records.filter( function ( req ) {
            var i = req.start;
            var l = i + req.count;
            var message, thread, messageSK;

            if ( length ) {
                l = Math.min( l, length );
            }

            while ( i < l ) {
                messageSK = storeKeys[i];
                if ( messageSK ) {
                    i += 1;
                } else {
                    messageSK = storeKeys[ l - 1 ];
                    if ( !messageSK ) { break; }
                    l -= 1;
                }
                // Fetch the Message objects (if not already fetched).
                // If already fetched, fetch the updates
                if ( collapseThreads ) {
                    if ( store.getStatus( messageSK ) & READY ) {
                        thread = store.getRecordFromStoreKey( messageSK )
                                      .get( 'thread' );
                        // If already fetched, fetch the updates
                        refresh( thread );
                        thread.get( 'messages' ).forEach( refresh );
                    } else {
                        JMAP.mail.fetchRecord(
                            store.getAccountIdFromStoreKey( messageSK ),
                            Message.Thread,
                            store.getIdFromStoreKey( messageSK )
                        );
                    }
                } else {
                    message = store.getRecordFromStoreKey( messageSK );
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

    sourceDidFetchSnippets: function ( accountId, snippets ) {
        var store = this.get( 'store' );
        var l = snippets.length;
        var snippet, emailId;
        while ( l-- ) {
            snippet = snippets[l];
            emailId = snippet.emailId;
            this._snippets[ emailId ] = snippet;
            if ( store.getRecordStatus(
                    accountId, Message, emailId ) & READY ) {
                // There is no "snippet" property, but this triggers the
                // observers of * property changes on the object.
                store.getRecord( accountId, Message, emailId )
                     .propertyDidChange( 'snippet' );
            }
        }
    },

    getSnippet: function ( emailId ) {
        var snippet = this._snippets[ emailId ];
        if ( !snippet ) {
            this._snippetsNeeded.push( emailId );
            this._snippets[ emailId ] = snippet = EMPTY_SNIPPET;
            this.fetchSnippets();
        }
        return snippet;
    },

    fetchSnippets: function () {
        JMAP.mail.callMethod( 'SearchSnippet/get', {
            accountId: this.get( 'accountId' ),
            emailIds: this._snippetsNeeded,
            filter: this.get( 'where' ),
        });
        this._snippetsNeeded = [];
    }.queue( 'after' )
});
MessageList.getId = getId;

JMAP.mail.handle( MessageList, {
    query: function ( query ) {
        var accountId = query.get( 'accountId' );
        var where = query.get( 'where' );
        var sort = query.get( 'sort' );
        var collapseThreads = query.get( 'collapseThreads' );
        var canGetDeltaUpdates = query.get( 'canGetDeltaUpdates' );
        var state = query.get( 'state' );
        var request = query.sourceWillFetchQuery();
        var hasMadeRequest = false;

        if ( canGetDeltaUpdates && state && request.refresh ) {
            var storeKeys = query.getStoreKeys();
            var length = storeKeys.length;
            var upto = ( length === query.get( 'length' ) ) ?
                    undefined : storeKeys[ length - 1 ];
            this.callMethod( 'Email/queryChanges', {
                accountId: accountId,
                filter: where,
                sort: sort,
                collapseThreads: collapseThreads,
                sinceState: state,
                upToId: upto ?
                    this.get( 'store' ).getIdFromStoreKey( upto ) : null,
                maxChanges: 250,
            });
        }

        if ( request.callback ) {
            this.addCallback( request.callback );
        }

        var get = function ( start, count, anchor, offset, fetchData ) {
            hasMadeRequest = true;
            this.callMethod( 'Email/query', {
                accountId: accountId,
                filter: where,
                sort: sort,
                collapseThreads: collapseThreads,
                position: start,
                anchor: anchor,
                anchorOffset: offset,
                limit: count,
            });
            if ( fetchData ) {
                this.callMethod( 'Email/get', {
                    accountId: accountId,
                    '#ids': {
                        resultOf: this.getPreviousMethodId(),
                        name: 'Email/query',
                        path: '/ids',
                    },
                    properties: collapseThreads ?
                        [ 'threadId' ] : Message.headerProperties,
                });
                if ( collapseThreads ) {
                    this.callMethod( 'Thread/get', {
                        accountId: accountId,
                        '#ids': {
                            resultOf: this.getPreviousMethodId(),
                            name: 'Email/get',
                            path: '/list/*/threadId',
                        },
                    });
                    this.callMethod( 'Email/get', {
                        accountId: accountId,
                        '#ids': {
                            resultOf: this.getPreviousMethodId(),
                            name: 'Thread/get',
                            path: '/list/*/emailIds',
                        },
                        properties: Message.headerProperties
                    });
                }
            }
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

        if ( ( ( query.get( 'status' ) & EMPTY ) &&
                !request.records.length ) ||
             ( !canGetDeltaUpdates && !hasMadeRequest && request.refresh ) ) {
            get( 0, query.get( 'windowSize' ), undefined, undefined, true );
        }
    },

    // ---

    'Email/query': function ( args ) {
        args.filter = args.filter || null;
        args.sort = args.sort || null;
        args.idList = args.ids;

        var store = this.get( 'store' );
        var query = store.getQuery( getId( args ) );

        if ( query ) {
            query.set( 'canGetDeltaUpdates', args.canCalculateChanges );
            query.sourceDidFetchIdList( args );
        }
    },

    'Email/queryChanges': function ( args ) {
        args.filter = args.filter || null;
        args.sort = args.sort || null;
        args.removed = args.removed || [];
        args.added = args.added ? args.added.map( function ( item ) {
            return [ item.index, item.id ];
        }) : [];
        args.upto = args.upToId;

        var store = this.get( 'store' );
        var query = store.getQuery( getId( args ) );

        if ( query ) {
            query.sourceDidFetchUpdate( args );
        }
    },

    'error_Email/queryChanges_cannotCalculateChanges': function ( _, __, reqArgs ) {
        this.response[ 'error_Email/queryChanges_tooManyChanges' ]
            .call( this,  _, __, reqArgs );
    },

    'error_Email/queryChanges_tooManyChanges': function ( _, __, reqArgs ) {
        var query = this.get( 'store' ).getQuery( getId( reqArgs ) );
        if ( query ) {
            query.reset();
        }
    },

    // ---

    'SearchSnippet/get': function ( args ) {
        var store = this.get( 'store' );
        var where = args.filter;
        var list = args.list;
        var accountId = args.accountId;
        store.getAllQueries().forEach( function ( query ) {
            if ( isEqual( query.get( 'where' ), where ) ) {
                query.sourceDidFetchSnippets( accountId, list );
            }
        });
    },
});

JMAP.mail.recalculateAllFetchedWindows = function () {
    // Mark all message lists as needing to recheck if window is fetched.
    this.get( 'store' ).getAllQueries().forEach( function ( query ) {
        if ( query instanceof MessageList ) {
            query.recalculateFetchedWindows();
        }
    });
};

// --- Export

JMAP.MessageList = MessageList;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: MessageSubmission.js                                                 \\
// Module: MailModel                                                          \\
// Requires: API, Mailbox.js, Message.js, Thread.js, Identity.js              \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;

const mail = JMAP.mail;
const Identity = JMAP.Identity;
const Message = JMAP.Message;
const Thread = JMAP.Thread;
const Mailbox = JMAP.Mailbox;
const makeSetRequest = JMAP.Connection.makeSetRequest;

// ---

const MessageSubmission = Class({

    Extends: Record,

    identity: Record.toOne({
        Type: Identity,
        key: 'identityId',
    }),

    message: Record.toOne({
        Type: Message,
        key: 'emailId',
    }),

    thread: Record.toOne({
        Type: Thread,
        key: 'threadId',
        noSync: true,
    }),

    envelope: attr( Object, {
        defaultValue: null,
    }),

    sendAt: attr( Date, {
        noSync: true,
    }),

    undoStatus: attr( String, {
        noSync: true,
        defaultValue: 'pending',
    }),

    deliveryStatus: attr( Object, {
        noSync: true,
        defaultValue: null,
    }),

    dsnBlobIds: attr( Array ),
    mdnBlobIds: attr( Array ),

    // ---

    // Not a real JMAP property; stripped before sending to server.
    onSuccess: attr( Object ),
});
MessageSubmission.__guid__ = 'EmailSubmission';
MessageSubmission.dataGroup = 'mail';

MessageSubmission.makeEnvelope = function ( message ) {
    var sender = message.get( 'sender' );
    var mailFrom = {
        email: sender ?
            sender.email :
            message.get( 'fromEmail' ),
        parameters: null,
    };
    var seen = {};
    var rcptTo = [ 'to', 'cc', 'bcc' ].reduce( function ( rcptTo, header ) {
        var addresses = message.get( header );
        if ( addresses ) {
            addresses.forEach( function ( address ) {
                var email = address.email;
                if ( email && !seen[ email ] ) {
                    seen[ email ] = true;
                    rcptTo.push({ email: email, parameters: null });
                }
            });
        }
        return rcptTo;
    }, [] );
    return {
        mailFrom: mailFrom,
        rcptTo: rcptTo,
    };
};


mail.handle( MessageSubmission, {

    precedence: 3,

    fetch: function ( accountId, ids ) {
        this.callMethod( 'EmailSubmission/get', {
            accountId: accountId,
            ids: ids || [],
        });
    },

    refresh: function ( accountId, ids, state ) {
        if ( ids ) {
            this.callMethod( 'EmailSubmission/get', {
                accountId: accountId,
                ids: ids,
            });
        } else {
            this.callMethod( 'EmailSubmission/changes', {
                accountId: accountId,
                sinceState: state,
                maxChanges: 50,
            });
            this.callMethod( 'EmailSubmission/get', {
                accountId: accountId,
                '#ids': {
                    resultOf: this.getPreviousMethodId(),
                    name: 'EmailSubmission/changes',
                    path: '/changed',
                },
            });
        }
    },

    commit: function ( change ) {
        var store = this.get( 'store' );
        var args = makeSetRequest( change );

        // TODO: Prevent double sending if dodgy connection
        // if ( Object.keys( args.create ).length ) {
        //     args.ifInState = change.state;
        // }

        var onSuccessUpdateEmail = {};
        var onSuccessDestroyEmail = [];
        var create = args.create;
        var update = args.update;
        var id, submission;

        var accountId = change.accountId;
        var drafts = mail.getMailboxForRole( accountId, 'drafts' );
        var sent = mail.getMailboxForRole( accountId, 'sent' );
        var updateMessage = {};
        if ( drafts && sent ) {
            updateMessage[ 'mailboxIds/' + sent.get( 'id' ) ] = null;
            updateMessage[ 'mailboxIds/' + drafts.get( 'id' ) ] = true;
        }
        updateMessage[ 'keywords/$draft' ] = true;

        // On create move from drafts, remove $draft keyword
        for ( id in create ) {
            submission = create[ id ];
            if ( submission.onSuccess === null ) {
                args.onSuccessDestroyEmail = onSuccessDestroyEmail;
                onSuccessDestroyEmail.push( '#' + id );
            } else if ( submission.onSuccess ) {
                args.onSuccessUpdateEmail = onSuccessUpdateEmail;
                onSuccessUpdateEmail[ '#' + id ] = submission.onSuccess;
            }
            delete submission.onSuccess;
        }

        // On unsend, move back to drafts, set $draft keyword.
        for ( id in update ) {
            submission = update[ id ];
            if ( submission.undoStatus === 'canceled' ) {
                args.onSuccessUpdateEmail = onSuccessUpdateEmail;
                onSuccessUpdateEmail[ submission.id ] = updateMessage;
            }
        }

        this.callMethod( 'EmailSubmission/set', args );
        if ( args.onSuccessUpdateEmail || args.onSuccessDestroyEmail ) {
            this.fetchAllRecords(
                accountId, Message, store.getTypeState( accountId, Message ) );
            this.fetchAllRecords(
                accountId, Mailbox, store.getTypeState( accountId, Mailbox ) );
        }
    },

    // ---

    'EmailSubmission/get': function ( args ) {
        this.didFetch( MessageSubmission, args );
    },

    'EmailSubmission/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( MessageSubmission, args, hasDataForChanged );
        if ( args.hasMoreChanges ) {
            this.get( 'store' )
                .fetchAll( args.accountId, MessageSubmission, true );
        }
    },

    'error_EmailSubmission/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var store = this.get( 'store' );
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Unload if possible, otherwise mark
        // obsolete.
        store.getAll( MessageSubmission ).forEach( function ( submission ) {
            if ( submission.get( 'accountId' ) === accountId ) {
                if ( !store.unloadRecord( submission.get( 'storeKey' ) ) ) {
                    submission.setObsolete();
                }
            }
        });
        // Tell the store we're now in the new state.
        store.sourceDidFetchUpdates(
            accountId,
            MessageSubmission,
            null,
            null,
            store.getTypeState( accountId, MessageSubmission ),
            ''
        );

    },

    'EmailSubmission/set': function ( args ) {
        this.didCommit( MessageSubmission, args );
    },

    'error_EmailSubmission/set_stateMismatch': function () {
        // TODO: Fire error on all creates, to check and try again.
    },
});

// --- Export

JMAP.MessageSubmission = MessageSubmission;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: VacationResponse.js                                                  \\
// Module: MailModel                                                          \\
// Requires: API                                                              \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

( function ( JMAP ) {

const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;

const mail = JMAP.mail;

// ---

const VacationResponse = Class({

    Extends: Record,

    isEnabled: attr( Boolean, {
        defaultValue: false,
    }),

    fromDate: attr( Date, {
        toJSON: Date.toUTCJSON,
        defaultValue: null,
    }),

    toDate: attr( Date, {
        toJSON: Date.toUTCJSON,
        defaultValue: null,
    }),

    subject: attr( String ),

    textBody: attr( String ),

    htmlBody: attr( String ),

    // ---

    hasDates: function ( hasDates ) {
        if ( hasDates === false ) {
            this.set( 'fromDate', null )
                .set( 'toDate', null );
        } else if ( hasDates === undefined ) {
            hasDates = !!(
                this.get( 'fromDate' ) ||
                this.get( 'toDate' )
            );
        }
        return hasDates;
    }.property( 'fromDate', 'toDate' ),
});
VacationResponse.__guid__ = 'VacationResponse';
VacationResponse.dataGroup = 'mail';

mail.handle( VacationResponse, {

    precedence: 3,

    fetch: 'VacationResponse/get',
    commit: 'VacationResponse/set',

    // ---

    'VacationResponse/get': function ( args ) {
        this.didFetch( VacationResponse, args );
    },

    'VacationResponse/set': function ( args ) {
        this.didCommit( VacationResponse, args );
    },
});

// --- Export

JMAP.VacationResponse = VacationResponse;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: mail-model.js                                                        \\
// Module: MailModel                                                          \\
// Requires: API, Mailbox.js, Thread.js, Message.js, MessageList.js, MessageSubmission.js \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const READY = O.Status.READY;

const auth = JMAP.auth;
const store = JMAP.store;
const Mailbox = JMAP.Mailbox;
const Thread = JMAP.Thread;
const Message = JMAP.Message;
const MessageList = JMAP.MessageList;
const MessageSubmission = JMAP.MessageSubmission;

// --- Preemptive mailbox count updates ---

const getMailboxDelta = function ( deltas, mailboxSK ) {
    return deltas[ mailboxSK ] || ( deltas[ mailboxSK ] = {
        totalEmails: 0,
        unreadEmails: 0,
        totalThreads: 0,
        unreadThreads: 0,
        removed: [],
        added: []
    });
};

const updateMailboxCounts = function ( mailboxDeltas ) {
    var mailboxSK, delta, mailbox;
    for ( mailboxSK in mailboxDeltas ) {
        delta = mailboxDeltas[ mailboxSK ];
        mailbox = store.getRecordFromStoreKey( mailboxSK );
        if ( delta.totalEmails ) {
            mailbox.increment( 'totalEmails', delta.totalEmails );
        }
        if ( delta.unreadEmails ) {
            mailbox.increment( 'unreadEmails', delta.unreadEmails );
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
               .fetch();
    }
};

// --- Preemptive query updates ---

const filterHasKeyword = function ( filter, keyword ) {
    return (
        keyword === filter.allInThreadHaveKeyword ||
        keyword === filter.someInThreadHaveKeyword ||
        keyword === filter.noneInThreadHaveKeyword ||
        keyword === filter.hasKeyword ||
        keyword === filter.notKeyword
    );
};

const isSortedOnUnread = function ( sort ) {
    for ( var i = 0, l = sort.length; i < l; i += 1 ) {
        if ( /:\$seen$/.test( sort[i].property ) ) {
            return true;
        }
    }
    return false;
};
const isFilteredOnUnread = function ( filter ) {
    if ( filter.operator ) {
        return filter.conditions.some( isFilteredOnUnread );
    }
    return filterHasKeyword( filter, '$seen' );
};
const isSortedOnFlagged = function ( sort ) {
    for ( var i = 0, l = sort.length; i < l; i += 1 ) {
        if ( /:\$flagged$/.test( sort[i].property ) ) {
            return true;
        }
    }
    return false;
};
const isFilteredOnFlagged = function ( filter ) {
    if ( filter.operator ) {
        return filter.conditions.some( isFilteredOnFlagged );
    }
    return filterHasKeyword( filter, '$flagged' );
};
const isFilteredOnMailboxes = function ( filter ) {
    if ( filter.operator ) {
        return filter.conditions.some( isFilteredOnMailboxes );
    }
    return ( 'inMailbox' in filter ) || ( 'inMailboxOtherThan' in filter );
};
const isFilteredJustOnMailbox = function ( filter ) {
    var isJustMailboxes = false;
    var term;
    for ( term in filter ) {
        if ( term === 'inMailbox' ) {
            isJustMailboxes = true;
        } else {
            isJustMailboxes = false;
            break;
        }
    }
    return isJustMailboxes;
};
const isTrue = function () {
    return true;
};
const isFalse = function () {
    return false;
};

// ---

const reOrFwd = /^(?:(?:re|fwd):\s*)+/;
const comparators = {
    id: function ( a, b ) {
        var aId = a.get( 'id' );
        var bId = b.get( 'id' );

        return aId < bId ? -1 : aId > bId ? 1 : 0;
    },
    receivedAt: function ( a, b ) {
        return a.get( 'receivedAt' ) - b.get( 'receivedAt' );
    },
    size: function ( a, b ) {
        return a.get( 'size' ) - b.get( 'size' );
    },
    from: function ( a, b ) {
        var aFrom = a.get( 'fromName' ) || a.get( 'fromEmail' );
        var bFrom = b.get( 'fromName' ) || b.get( 'fromEmail' );

        return aFrom < bFrom ? -1 : aFrom > bFrom ? 1 : 0;
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
    'hasKeyword:$flagged': function ( a, b ) {
        var aFlagged = a.get( 'isFlagged' );
        var bFlagged = b.get( 'isFlagged' );

        return aFlagged === bFlagged ? 0 :
            aFlagged ? -1 : 1;
    },
    'someInThreadHaveKeyword:$flagged': function ( a, b ) {
        return comparators[ 'hasKeyword:$flagged' ]
            ( a.get( 'thread' ), b.get( 'thread' ) );
    },
};

const compareToStoreKey = function ( fields, storeKey, message ) {
    var otherMessage = storeKey && ( store.getStatus( storeKey ) & READY ) ?
            store.getRecordFromStoreKey( storeKey ) : null;
    var i, l, field, comparator, result;
    if ( !otherMessage ) {
        return 1;
    }
    for ( i = 0, l = fields.length; i < l; i += 1 ) {
        field = fields[i];
        comparator = comparators[ field.property ];
        if ( comparator && ( result = comparator( otherMessage, message ) ) ) {
            if ( !field.isAscending ) {
                result = -result;
            }
            return result;
        }
    }
    return 0;
};

const compareToMessage = function ( fields, aData, bData ) {
    var a = aData.message;
    var b = bData.message;
    var i, l, field, comparator, result;
    for ( i = 0, l = fields.length; i < l; i += 1 ) {
        field = fields[i];
        comparator = comparators[ field.property ];
        if ( comparator && ( result = comparator( a, b ) ) ) {
            if ( !field.isAscending ) {
                result = -result;
            }
            return result;
        }
    }
    return 0;
};

const calculatePreemptiveAdd = function ( query, addedMessages, replaced ) {
    var storeKeys = query.getStoreKeys();
    var sort = query.get( 'sort' );
    var comparator = compareToStoreKey.bind( null, sort );
    var threadSKToIndex = {};
    var indexDelta = 0;
    var added, i, l, messageSK, threadSK;

    added = addedMessages.reduce( function ( added, message ) {
        added.push({
            message: message,
            messageSK: message.get( 'storeKey' ),
            threadSK: message.getFromPath( 'thread.storeKey' ),
            index: storeKeys.binarySearch( message, comparator )
        });
        return added;
    }, [] );
    added.sort( compareToMessage.bind( null, sort ) );

    if ( !added.length ) {
        return null;
    }

    if ( query.get( 'collapseThreads' ) ) {
        l = Math.min( added.last().index, storeKeys.length );
        for ( i = 0; i < l; i += 1 ) {
            messageSK = storeKeys[i];
            if ( messageSK && ( store.getStatus( messageSK ) & READY ) ) {
                threadSK = store.getRecordFromStoreKey( messageSK )
                                .getData()
                                .threadId;
                threadSKToIndex[ threadSK ] = i;
            }
        }
    }

    return added.reduce( function ( result, item ) {
        var threadIndex = item.threadSK && threadSKToIndex[ item.threadSK ];
        if ( threadIndex !== undefined ) {
            if ( threadIndex >= item.index ) {
                replaced.push( storeKeys[ threadIndex ] );
            } else {
                return result;
            }
        }
        result.push([ item.index + indexDelta, item.messageSK ]);
        indexDelta += 1;
        return result;
    }, [] );
};

const updateQueries = function ( filterTest, sortTest, deltas ) {
    // Set as obsolete any message list that is filtered by
    // one of the removed or added mailboxes. If it's a simple query,
    // pre-emptively update it.
    var queries = store.getAllQueries();
    var l = queries.length;
    var query, filter, sort, mailboxSK, delta, replaced, added;
    while ( l-- ) {
        query = queries[l];
        if ( query instanceof MessageList ) {
            filter = query.get( 'where' );
            sort = query.get( 'sort' );
            if ( deltas && isFilteredJustOnMailbox( filter ) ) {
                mailboxSK = store.getStoreKey(
                    query.get( 'accountId' ), Mailbox, filter.inMailbox );
                delta = deltas[ mailboxSK ];
                if ( delta ) {
                    replaced = [];
                    added =
                        calculatePreemptiveAdd( query, delta.added, replaced );
                    query.clientDidGenerateUpdate({
                        added: added,
                        removed: delta.removed,
                    });
                    if ( replaced.length ) {
                        query.clientDidGenerateUpdate({
                            added: null,
                            removed: replaced,
                        });
                    }
                }
            } else if ( filterTest( filter ) || sortTest( sort ) ) {
                query.setObsolete();
            }
        }
    }
};

// ---

const identity = function ( v ) { return v; };

const addMoveInverse = function ( inverse, undoManager, willAdd, willRemove, messageSK ) {
    var l = willRemove ? willRemove.length : 1;
    var i, addMailbox, removeMailbox, key, data;
    for ( i = 0; i < l; i += 1 ) {
        addMailbox = willAdd ? willAdd[0] : null;
        removeMailbox = willRemove ? willRemove[i] : null;
        key = ( addMailbox ? addMailbox.get( 'storeKey' ) : '-' ) +
            ( removeMailbox ? removeMailbox.get( 'storeKey' ) : '-' );
        data = inverse[ key ];
        if ( !data ) {
            data = {
                method: 'move',
                messageSKs: [],
                args: [ null, removeMailbox, addMailbox, true ],
            };
            inverse[ key ] = data;
            undoManager.pushUndoData( data );
        }
        data.messageSKs.push( messageSK );
        willAdd = null;
    }
};

// ---

const NO = 0;
const TO_MAILBOX = 1;
const TO_THREAD_IN_NOT_TRASH = 2;
const TO_THREAD_IN_TRASH = 4;
const TO_THREAD = (TO_THREAD_IN_NOT_TRASH|TO_THREAD_IN_TRASH);

const getMessages = function getMessages ( messageSKs, expand, mailbox, callback, hasDoneLoad ) {
    // Map to threads, then make sure all threads, including headers
    // are loaded
    var allLoaded = true;
    var messages = [];

    var checkMessage = function ( message ) {
        if ( message.is( READY ) ) {
            if ( expand === TO_MAILBOX && mailbox ) {
                if ( message.get( 'mailboxes' ).contains( mailbox ) ) {
                    messages.push( message );
                }
            } else if ( expand & TO_THREAD ) {
                if ( (( expand & TO_THREAD_IN_NOT_TRASH ) &&
                        message.get( 'isInNotTrash' )) ||
                     (( expand & TO_THREAD_IN_TRASH ) &&
                        message.get( 'isInTrash' )) ) {
                    messages.push( message );
                }
            } else {
                messages.push( message );
            }
        } else {
            allLoaded = false;
        }
    };

    messageSKs.forEach( function ( messageSK ) {
        var thread, message;
        if ( expand ) {
            if ( store.getStatus( messageSK ) & READY ) {
                thread = store.getRecordFromStoreKey( messageSK )
                              .get( 'thread' );
                if ( thread.is( READY ) ) {
                    thread.get( 'messages' ).forEach( checkMessage );
                } else {
                    allLoaded = false;
                }
            } else {
                // Fetch all messages in thread
                JMAP.mail.fetchRecord(
                    store.getAccountIdFromStoreKey( messageSK ),
                    Message.Thread,
                    store.getIdFromStoreKey( messageSK ) );
                allLoaded = false;
            }
        } else {
            message = store.getRecordFromStoreKey( messageSK );
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
                messageSKs, expand, mailbox, callback, true )
        );
    }
    return true;
};

// ---

const doUndoAction = function ( method, args ) {
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

const roleIndex = new O.Object({
    index: null,
    clearIndex: function () {
        this.index = null;
    },
    buildIndex: function () {
        var index = this.index = store.getAll( Mailbox ).reduce(
            function ( index, mailbox ) {
                var accountId = mailbox.get( 'accountId' );
                var role = mailbox.get( 'role' );
                if ( role ) {
                    ( index[ accountId ] ||
                        ( index[ accountId ] = {} ) )[ role ] = mailbox;
                }
                return index;
            }, {} );
        return index;
    },
    getIndex: function () {
        return this.index || this.buildIndex();
    },
});
store.on( Mailbox, roleIndex, 'clearIndex' );

const getMailboxForRole = function ( accountId, role ) {
    if ( !accountId ) {
        accountId = auth.get( 'defaultAccountId' );
    }
    var accountIndex = roleIndex.getIndex()[ accountId ];
    return accountIndex && accountIndex[ role ] || null;
};

// ---

Object.assign( JMAP.mail, {

    getMessages: getMessages,

    getMailboxForRole: getMailboxForRole,

    // ---

    findMessage: function ( accountId, where ) {
        return new Promise( function ( resolve, reject ) {
            JMAP.mail.callMethod( 'Email/query', {
                accountId: accountId,
                filter: where,
                sort: null,
                position: 0,
                limit: 1,
            }, function ( response ) {
                var call = response[0];
                var method = call[0];
                var args = call[1];
                var id;
                if ( method === 'Email/query' ) {
                    id = args.ids[0];
                    if ( id ) {
                        resolve( store.getRecord( accountId, Message, id ) );
                    } else {
                        reject({
                            type: 'notFound',
                        });
                    }
                } else {
                    reject( args );
                }
            }).callMethod( 'Email/get', {
                '#ids': {
                    resultOf: JMAP.mail.getPreviousMethodId(),
                    name: 'Email/query',
                    path: '/ids',
                },
                properties: Message.headerProperties,
            });
        });
    },

    // ---

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
                var queries = store.getAllQueries();
                var l = queries.length;
                var query;
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
            var pending = this.pending;
            var sequence = new JMAP.Sequence();
            var l = data.length;
            var call, messageSKs;

            while ( l-- ) {
                call = data[l];
                messageSKs = call.messageSKs;
                if ( messageSKs ) {
                    sequence.then(
                        getMessages.bind( null, messageSKs, NO, null ) );
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

    setUnread: function ( messages, isUnread, allowUndo ) {
        var mailboxDeltas = {};
        var inverseMessageSKs = allowUndo ? [] : null;
        var inverse = allowUndo ? {
                method: 'setUnread',
                messageSKs: inverseMessageSKs,
                args: [
                    null,
                    !isUnread,
                    true
                ]
            } : null;

        messages.forEach( function ( message ) {
            // Check we have something to do
            if ( message.get( 'isUnread' ) === isUnread ||
                    !message.hasPermission( 'maySetSeen' ) ) {
                return;
            }

            // Get the thread and cache the current unread state
            var thread = message.get( 'thread' );
            var isInTrash = message.get( 'isInTrash' );
            var isInNotTrash = message.get( 'isInNotTrash' );
            var threadUnreadInTrash =
                isInTrash && thread && thread.get( 'isUnreadInTrash' ) ?
                1 : 0;
            var threadUnreadInNotTrash =
                isInNotTrash && thread && thread.get( 'isUnreadInNotTrash' ) ?
                1 : 0;
            var mailboxCounts, mailboxSK, mailbox, delta, unreadDelta;

            // Update the message
            message.set( 'isUnread', isUnread );

            // Add inverse for undo
            if ( allowUndo ) {
                inverseMessageSKs.push( message.get( 'storeKey' ) );
            }

            // Draft messages unread status don't count in mailbox unread counts
            if ( message.get( 'isDraft' ) ) {
                return;
            }

            // Calculate any changes to the mailbox unread message counts
            message.get( 'mailboxes' ).forEach( function ( mailbox ) {
                var mailboxSK = mailbox.get( 'storeKey' );
                var delta = getMailboxDelta( mailboxDeltas, mailboxSK );
                delta.unreadEmails += isUnread ? 1 : -1;
            });

            // See if the thread unread state has changed
            if ( isInTrash && thread ) {
                threadUnreadInTrash =
                    Number( thread.get( 'isUnreadInTrash' ) ) -
                        threadUnreadInTrash;
            }
            if ( isInNotTrash && thread ) {
                threadUnreadInNotTrash =
                    Number( thread.get( 'isUnreadInNotTrash' ) ) -
                        threadUnreadInNotTrash;
            }

            // Calculate any changes to the mailbox unread thread counts
            if ( threadUnreadInNotTrash || threadUnreadInTrash ) {
                mailboxCounts = thread.get( 'mailboxCounts' );
                for ( mailboxSK in mailboxCounts ) {
                    mailbox = store.getRecordFromStoreKey( mailboxSK );
                    unreadDelta = mailbox.get( 'role' ) === 'trash' ?
                        threadUnreadInTrash : threadUnreadInNotTrash;
                    if ( unreadDelta ) {
                        delta = getMailboxDelta( mailboxDeltas, mailboxSK );
                        delta.unreadThreads += unreadDelta;
                    }
                }
            }
        });

        // Update counts on mailboxes
        updateMailboxCounts( mailboxDeltas );

        // Update message list queries, or mark in need of refresh
        updateQueries( isFilteredOnUnread, isSortedOnUnread, null );

        if ( allowUndo && inverseMessageSKs.length ) {
            this.undoManager.pushUndoData( inverse );
        }

        return this;
    },

    setFlagged: function ( messages, isFlagged, allowUndo ) {
        var inverseMessageSKs = allowUndo ? [] : null;
        var inverse = allowUndo ? {
                method: 'setFlagged',
                messageSKs: inverseMessageSKs,
                args: [
                    null,
                    !isFlagged,
                    true
                ]
            } : null;

        messages.forEach( function ( message ) {
            // Check we have something to do
            if ( message.get( 'isFlagged' ) === isFlagged ||
                    !message.hasPermission( 'maySetKeywords' ) ) {
                return;
            }

            // Update the message
            message.set( 'isFlagged', isFlagged );

            // Add inverse for undo
            if ( allowUndo ) {
                inverseMessageSKs.push( message.get( 'storeKey' ) );
            }
        });

        // Update message list queries, or mark in need of refresh
        updateQueries( isFilteredOnFlagged, isSortedOnFlagged, null );

        if ( allowUndo && inverseMessageSKs.length ) {
            this.undoManager.pushUndoData( inverse );
        }

        return this;
    },

    move: function ( messages, addMailbox, removeMailbox, allowUndo ) {
        var mailboxDeltas = {};
        var inverse = allowUndo ? {} : null;
        var removeAll = removeMailbox === 'ALL';
        var undoManager = this.undoManager;
        var addMailboxOnlyIfNone = false;
        var accountId;
        if ( !addMailbox ) {
            addMailboxOnlyIfNone = true;
            accountId = messages.length ?
                messages[0].get( 'accountId' ) : null;
            addMailbox =
                getMailboxForRole( accountId, 'archive' ) ||
                getMailboxForRole( accountId, 'inbox' );
        }
        if ( removeAll ) {
            removeMailbox = null;
        }

        // Check we're not moving from/to the same place
        if ( addMailbox === removeMailbox && !addMailboxOnlyIfNone ) {
            return;
        }

        // Check ACLs
        if ( addMailbox && ( !addMailbox.is( READY ) ||
                !addMailbox.get( 'myRights' ).mayAddItems ) ) {
            O.RunLoop.didError({
                name: 'JMAP.mail.move',
                message: 'May not add messages to ' + addMailbox.get( 'name' ),
            });
            return this;
        }
        if ( removeMailbox && ( !removeMailbox.is( READY ) ||
                !removeMailbox.get( 'myRights' ).mayRemoveItems ) ) {
            O.RunLoop.didError({
                name: 'JMAP.mail.move',
                message: 'May not remove messages from ' +
                    removeMailbox.get( 'name' ),
            });
            return this;
        }

        messages.forEach( function ( message ) {
            var messageSK = message.get( 'storeKey' );
            var mailboxes = message.get( 'mailboxes' );

            // Calculate the set of mailboxes to add/remove
            var willAdd = addMailbox && [ addMailbox ];
            var willRemove = null;
            var mailboxToRemoveIndex = -1;
            var alreadyHasMailbox = false;

            var wasThreadUnreadInNotTrash = false;
            var wasThreadUnreadInTrash = false;
            var isThreadUnreadInNotTrash = false;
            var isThreadUnreadInTrash = false;
            var mailboxCounts = null;

            var isUnread, thread;
            var deltaThreadUnreadInNotTrash, deltaThreadUnreadInTrash;
            var decrementMailboxCount, incrementMailboxCount;
            var delta, mailboxSK, mailbox;

            // Calculate the changes required to the message's mailboxes
            if ( removeAll ) {
                willRemove = mailboxes.map( identity );
                mailboxToRemoveIndex = 0;
                alreadyHasMailbox = mailboxes.contains( addMailbox );
                if ( alreadyHasMailbox && willRemove.length === 1 ) {
                    willRemove = willAdd = null;
                }
            } else {
                mailboxes.forEach( function ( mailbox, index ) {
                    if ( mailbox === addMailbox ) {
                        willAdd = null;
                    }
                    if ( mailbox === removeMailbox ) {
                        willRemove = [ mailbox ];
                        mailboxToRemoveIndex = index;
                    }
                });
            }

            // Check we have something to do
            if ( !willRemove && ( !willAdd || addMailboxOnlyIfNone ) ) {
                return;
            }

            if ( addMailboxOnlyIfNone ) {
                if ( willRemove.length !== mailboxes.get( 'length' ) ) {
                    willAdd = null;
                } else if ( !willAdd ) {
                    // Can't remove from everything without adding
                    return;
                }
            }

            // Get the thread and cache the current unread state
            isUnread = message.get( 'isUnread' ) && !message.get( 'isDraft' );
            thread = message.get( 'thread' );
            if ( thread ) {
                wasThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
                wasThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );
            }

            // Update the message
            mailboxes.replaceObjectsAt(
                willRemove ? mailboxToRemoveIndex : mailboxes.get( 'length' ),
                willRemove ? willRemove.length : 0,
                willAdd
            );
            // #if FASTMAIL
            if ( willRemove ) {
                message.set( 'previousMailbox', willRemove[0] );
            }
            // #end

            if ( alreadyHasMailbox ) {
                willAdd = null;
                willRemove.erase( addMailbox );
            }

            // Add inverse for undo
            if ( allowUndo ) {
                addMoveInverse( inverse, undoManager,
                    willAdd, willRemove, messageSK );
            }

            // Calculate any changes to the mailbox message counts
            if ( thread ) {
                isThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
                isThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );
                mailboxCounts = thread.get( 'mailboxCounts' );
            }

            decrementMailboxCount = function ( mailbox ) {
                var mailboxSK = mailbox.get( 'storeKey' );
                var delta = getMailboxDelta( mailboxDeltas, mailboxSK );
                delta.removed.push( messageSK );
                delta.totalEmails -= 1;
                if ( isUnread ) {
                    delta.unreadEmails -= 1;
                }
                // If this was the last message in the thread in the mailbox
                if ( thread && !mailboxCounts[ mailboxSK ] ) {
                    delta.totalThreads -= 1;
                    if ( mailbox.get( 'role' ) === 'trash' ?
                            wasThreadUnreadInTrash :
                            wasThreadUnreadInNotTrash ) {
                        delta.unreadThreads -= 1;
                    }
                }
            };
            incrementMailboxCount = function ( mailbox ) {
                var mailboxSK = mailbox.get( 'storeKey' );
                var delta = getMailboxDelta( mailboxDeltas, mailboxSK );
                delta.added.push( message );
                delta.totalEmails += 1;
                if ( isUnread ) {
                    delta.unreadEmails += 1;
                }
                // If this was the first message in the thread in the
                // mailbox
                if ( thread && mailboxCounts[ mailboxSK ] === 1 ) {
                    delta.totalThreads += 1;
                    if ( mailbox.get( 'role' ) === 'trash' ?
                            isThreadUnreadInTrash : isThreadUnreadInNotTrash ) {
                        delta.unreadThreads += 1;
                    }
                }
            };

            if ( willRemove ) {
                willRemove.forEach( decrementMailboxCount );
            }
            if ( willAdd ) {
                willAdd.forEach( incrementMailboxCount );
            }

            // If the thread unread state has changed (due to moving in/out of
            // trash), we might need to update mailboxes that the messages is
            // not in now and wasn't in before!
            // We need to adjust the count for any mailbox that hasn't already
            // been updated above. This means it must either:
            // 1. Have more than 1 message in the thread in it; or
            // 2. Not have been in the set of mailboxes we just added to this
            //    message
            deltaThreadUnreadInNotTrash =
                ( isThreadUnreadInNotTrash ? 1 : 0 ) -
                ( wasThreadUnreadInNotTrash ? 1 : 0 );
            deltaThreadUnreadInTrash =
                ( isThreadUnreadInTrash ? 1 : 0 ) -
                ( wasThreadUnreadInTrash ? 1 : 0 );

            if ( deltaThreadUnreadInNotTrash || deltaThreadUnreadInTrash ) {
                for ( mailboxSK in mailboxCounts ) {
                    mailbox = store.getRecordFromStoreKey( mailboxSK );
                    if ( mailboxCounts[ mailboxSK ] > 1 ||
                            !willAdd.contains( mailbox ) ) {
                        delta = getMailboxDelta( mailboxDeltas, mailboxSK );
                        if ( mailbox.get( 'role' ) === 'trash' ) {
                            delta.unreadThreads += deltaThreadUnreadInTrash;
                        } else {
                            delta.unreadThreads += deltaThreadUnreadInNotTrash;
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
            var messageSK = message.get( 'storeKey' );
            var mailboxes = message.get( 'mailboxes' );

            var wasThreadUnreadInNotTrash = false;
            var wasThreadUnreadInTrash = false;
            var isThreadUnreadInNotTrash = false;
            var isThreadUnreadInTrash = false;
            var mailboxCounts = null;

            var isUnread, thread;
            var deltaThreadUnreadInNotTrash, deltaThreadUnreadInTrash;
            var delta, mailboxSK, mailbox, messageWasInMailbox, isTrash;

            // Get the thread and cache the current unread state
            isUnread = message.get( 'isUnread' ) && !message.get( 'isDraft' );
            thread = message.get( 'thread' );
            if ( thread ) {
                mailboxCounts = thread.get( 'mailboxCounts' );
                wasThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
                wasThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );
            }

            // Update the message
            message.destroy();

            if ( thread ) {
                // Preemptively update the thread
                thread.get( 'messages' ).remove( message );
                thread.fetch();

                // Calculate any changes to the mailbox message counts
                isThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
                isThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );

                deltaThreadUnreadInNotTrash =
                    ( isThreadUnreadInNotTrash ? 1 : 0 ) -
                    ( wasThreadUnreadInNotTrash ? 1 : 0 );
                deltaThreadUnreadInTrash =
                    ( isThreadUnreadInTrash ? 1 : 0 ) -
                    ( wasThreadUnreadInTrash ? 1 : 0 );

                for ( mailboxSK in mailboxCounts ) {
                    mailbox = store.getRecordFromStoreKey( mailboxSK );
                    messageWasInMailbox = mailboxes.contains( mailbox );
                    isTrash = mailbox.get( 'role' ) === 'trash';
                    if ( messageWasInMailbox ) {
                        delta = getMailboxDelta( mailboxDeltas, mailboxSK );
                        delta.totalEmails -= 1;
                        if ( isUnread ) {
                            delta.unreadEmails -= 1;
                        }
                        delta.removed.push( messageSK );
                        if ( mailboxCounts[ mailboxSK ] === 1 ) {
                            delta.totalThreads -= 1;
                        }
                    }
                    if ( isTrash && deltaThreadUnreadInTrash ) {
                        getMailboxDelta( mailboxDeltas, mailboxSK )
                            .unreadThreads += deltaThreadUnreadInTrash;
                    } else if ( !isTrash && deltaThreadUnreadInNotTrash ) {
                        getMailboxDelta( mailboxDeltas, mailboxSK )
                            .unreadThreads += deltaThreadUnreadInNotTrash;
                    }
                }
            } else {
                mailboxes.forEach( function ( mailbox ) {
                    var delta = getMailboxDelta(
                        mailboxDeltas, mailbox.get( 'storeKey' ) );
                    delta.totalEmails -= 1;
                    if ( isUnread ) {
                        delta.unreadEmails -= 1;
                    }
                    delta.removed.push( messageSK );
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
        var messageSKs = [];
        var accounts = {};
        var accountId;

        messages.forEach( function ( message ) {
            var accountId = message.get( 'accountId' );
            var account = accounts[ accountId ] ||
                ( accounts[ accountId ] = [] );
            account.push( message.get( 'id' ) );
            messageSKs.push( message.get( 'storeKey' ) );
        });

        for ( accountId in accounts ) {
            this.callMethod( 'Email/report', {
                accountId: accountId,
                ids: accounts[ accountId ],
                type: asSpam ? 'spam' : 'notspam',
            });
        }

        if ( allowUndo ) {
            this.undoManager.pushUndoData({
                method: 'report',
                messageSKs: messageSKs,
                args: [
                    null,
                    !asSpam,
                    true
                ],
            });
        }

        return this;
    },

    // ---

    create: function ( message ) {
        var thread = message.get( 'thread' );
        var mailboxes = message.get( 'mailboxes' );
        var wasThreadUnreadInNotTrash = false;
        var wasThreadUnreadInTrash = false;
        var isThreadUnreadInNotTrash = false;
        var isThreadUnreadInTrash = false;
        var deltaThreadUnreadInTrash = false;
        var deltaThreadUnreadInNotTrash = false;
        var isDraft = message.get( 'isDraft' );
        var isUnread = !isDraft && message.get( 'isUnread' );
        var mailboxDeltas = {};
        var mailboxCounts = null;
        var messageSK, mailboxSK, mailbox, isTrash;

        // Cache the current thread state
        if ( thread && thread.is( READY ) ) {
            mailboxCounts = thread.get( 'mailboxCounts' );
            wasThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
            wasThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );
        }

        // If not in any mailboxes, make it a draft
        if ( mailboxes.get( 'length' ) === 0 ) {
            message
                .set( 'isDraft', true )
                .set( 'isUnread', false );
            mailboxes.add(
                getMailboxForRole( message.get( 'accountId' ), 'drafts' ) ||
                getMailboxForRole( null, 'drafts' )
            );
        }

        // Create the message
        message.saveToStore();
        messageSK = message.get( 'storeKey' );

        if ( mailboxCounts ) {
            // Preemptively update the thread
            var inReplyTo = isDraft &&
                    message.getFromPath( 'headers.in-reply-to' ) || '';
            var messages = thread.get( 'messages' );
            var seenInReplyTo = false;
            var l = messages.get( 'length' );
            var i, messageInThread;

            if ( inReplyTo ) {
                for ( i = 0; i < l; i += 1 ) {
                    messageInThread = messages.getObjectAt( i );
                    if ( seenInReplyTo ) {
                        if ( !messageInThread.get( 'isDraft' ) ||
                                inReplyTo !== messageInThread
                                    .getFromPath( 'headers.in-reply-to' ) ) {
                            break;
                        }
                    } else if ( inReplyTo === messageInThread
                            .getFromPath( 'headers.message-id' ) ) {
                        seenInReplyTo = true;
                    }
                }
            } else {
                i = l;
            }
            messages.replaceObjectsAt( i, 0, [ message ] );
            thread.fetch();

            // Calculate any changes to the mailbox message counts
            isThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
            isThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );

            deltaThreadUnreadInNotTrash =
                ( isThreadUnreadInNotTrash ? 1 : 0 ) -
                ( wasThreadUnreadInNotTrash ? 1 : 0 );
            deltaThreadUnreadInTrash =
                ( isThreadUnreadInTrash ? 1 : 0 ) -
                ( wasThreadUnreadInTrash ? 1 : 0 );
        }

        mailboxes.forEach( function ( mailbox ) {
            var mailboxSK = mailbox.get( 'storeKey' );
            var delta = getMailboxDelta( mailboxDeltas, mailboxSK );
            delta.added.push( message );
            delta.totalEmails += 1;
            if ( isUnread ) {
                delta.unreadEmails += 1;
            }
            if ( mailboxCounts && !mailboxCounts[ mailboxSK ] ) {
                delta.totalThreads += 1;
                if ( mailbox.get( 'role' ) === 'trash' ?
                        isThreadUnreadInTrash : isThreadUnreadInNotTrash ) {
                    delta.unreadThreads += 1;
                }
            }
        });

        for ( mailboxSK in mailboxCounts ) {
            mailbox = store.getRecordFromStoreKey( mailboxSK );
            isTrash = mailbox.get( 'role' ) === 'trash';
            if ( !mailboxes.contains( mailbox ) ) {
                if ( isTrash && deltaThreadUnreadInTrash ) {
                    getMailboxDelta( mailboxDeltas, mailboxSK )
                        .unreadThreads += deltaThreadUnreadInTrash;
                } else if ( !isTrash && deltaThreadUnreadInNotTrash ) {
                    getMailboxDelta( mailboxDeltas, mailboxSK )
                        .unreadThreads += deltaThreadUnreadInNotTrash;
                }
            }
        }

        // Update counts on mailboxes
        updateMailboxCounts( mailboxDeltas );

        // Update message list queries, or mark in need of refresh
        updateQueries( isTrue, isFalse, mailboxDeltas );

        return this;
    },

    // ---

    redirect: function ( messages, identity, to ) {
        var accountId = identity.get( 'accountId' );
        var envelope = {
            mailFrom: {
                email: identity.get( 'email' ),
                parameters: null,
            },
            rcptTo: to.map( function ( address ) {
                return {
                    email: address.email,
                    parameters: null,
                };
            }),
        };

        return messages.map( function ( message ) {
            return new MessageSubmission( store )
                .set( 'accountId', accountId )
                .set( 'identity', identity )
                .set( 'message', message )
                .set( 'envelope', envelope )
                .saveToStore();
        });
    },
});

}( JMAP ) );
