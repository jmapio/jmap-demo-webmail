// -------------------------------------------------------------------------- \\
// File: state.js                                                             \\
// Module: Mail                                                               \\
// Requires: namespace.js                                                     \\
// -------------------------------------------------------------------------- \\

/*global O, App, JMAP, btoa, location */

O.RunLoop.invoke( function () {

var i18n = O.i18n;
var Status = O.Status;
var LOADING = Status.LOADING;
var EMPTY_OR_OBSOLETE = Status.EMPTY | Status.OBSOLETE;

var store = JMAP.store;
var MessageList = JMAP.MessageList;
var Mailbox = JMAP.Mailbox;
var Thread = JMAP.Thread;
var Message = JMAP.Message;

// ---

var byMailSourceOrder = function ( a, b ) {
    if ( a === b ) {
        return 0;
    }
    if ( a.get( 'parent' ) !== b.get( 'parent' ) ) {
        var aParents = [a];
        var bParents = [b];
        var parent = a;
        var al, bl;

        while (( parent = parent.get( 'parent' ) )) {
            if ( parent === b ) {
                return 1;
            }
            aParents.push( parent );
        }
        parent = b;
        while (( parent = parent.get( 'parent' ) )) {
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
    var aRole = a.get( 'role' );
    var bRole = b.get( 'role' );
    return ( a.get( 'sortOrder' ) - b.get( 'sortOrder' ) ) ||
        ( aRole === 'inbox' ?
            -1 :
          bRole === 'inbox' ?
            1 :
        aRole && !bRole ?
            -1 :
        bRole && !aRole ?
            1 : 0 ) ||
        i18n.compare( a.get( 'name' ), b.get( 'name' ) ) ||
        ( a.get( 'id' ) < b.get( 'id' ) ? -1 : 1 );
};

var rootMailboxes = store.getQuery( 'rootMailboxes', O.LocalQuery, {
    Type: Mailbox,
    filter: function ( data ) {
        return !data.parentId;
    },
    sort: Mailbox.bySortOrderRoleOrName,
});

var allMailboxes = new O.ObservableArray( null, {
    content: store.getQuery( 'allMailboxes', O.LocalQuery, {
        Type: Mailbox,
    }),
    contentDidChange: function () {
        var mailboxes = this.get( 'content' ).get( '[]' );
        mailboxes.sort( byMailSourceOrder );
        return this.set( '[]', mailboxes );
    }.queue( 'before' ),
}).contentDidChange();
store.on( Mailbox, allMailboxes, 'contentDidChange' );

// ---

App.state = new O.Router({

    baseUrl: location.origin === 'https://jmap.io' ?
        'https://jmap.io/jmap-demo-webmail/' :
        location.origin + '/',

    routes: [
        // Selected conversation
        {
            url: /^(.+)$/,
            handle: function ( _, queryParams, emailId ) {
                this.selection.selectNone();
                this.beginPropertyChanges()
                    .set( 'emailId', emailId )
                    .endPropertyChanges();
            },
        },
        // Default
        {
            url: /.*/,
            handle: function () {
                this.selection.selectNone();
                this.beginPropertyChanges()
                    .set( 'emailId', '' )
                    .endPropertyChanges();
            },
        },
    ],

    encodedState: function () {
        return this.get( 'emailId' );
    }.property( 'emailId' ),

    // ---

    mailbox: null,
    thread: null,
    emailId: '',

    mailboxMessageList: function () {
        var mailboxId = this.getFromPath( 'mailbox.id' );
        if ( !mailboxId ) {
            return null;
        }
        var args = {
            autoRefresh: O.Query.AUTO_REFRESH_IF_OBSERVED,
            accountId: this.get( 'mailbox' ).get( 'accountId' ),
            where: { inMailbox: mailboxId },
            sort: [{ property: 'receivedAt', isAscending: false }],
            collapseThreads: true,
        };
        var id = MessageList.getId( args );
        return store.getQuery( id, MessageList, args );
    }.property( 'mailbox' ),

    threadStatusDidChange: function ( thread, __, ___, status ) {
        if ( status ) {
            if ( ( status & EMPTY_OR_OBSOLETE ) && !( status & LOADING ) ) {
                thread.refresh();
            }
        }
    }.observes( 'thread.status' ),

    threadMessageList: function () {
        var thread = this.get( 'thread' );
        return thread ?
            thread.get( 'messages' ) :
            null;
    }.property( 'thread' ),

    // --- Navigation ---

    go: function ( message ) {
        var exists = message && message.is( O.Status.READY );
        if ( exists ) {
            this.selectedMessage.set( 'record', message );
        }
        return !!exists;
    },

    goPrev: function () {
        var selected = this.selectedMessage;
        return this.go(
            selected.get( 'record' ) ?
                selected.get( 'prev' ) :
                this.getFromPath( 'mailboxMessageList.0' )
        );
    },

    goNext: function () {
        var selected = this.selectedMessage;
        return this.go(
            selected.get( 'record' ) ?
                selected.get( 'next' ) :
                this.getFromPath( 'mailboxMessageList.0' )
        );
    },

    // --- Agenda ---

    showAgenda: false,

    toggleAgenda: function () {
        this.toggle( 'showAgenda' );
    },

    // --- Refresh ---

    refresh: function () {
        var list = this.get( 'mailboxMessageList' );
        if ( list ) {
            list.refresh( true );
        }
        store.fetchAll( Mailbox, true )
             .fetchAll( Message, true )
             .fetchAll( Thread, true );
    },

    // --- Queries ---

    allMailboxes: allMailboxes,
    rootMailboxes: rootMailboxes,

    // --- Title ---

    mailboxName: O.bind( 'mailbox.name' ),
    mailboxUnread: O.bind( 'mailbox.unreadThreads' ),

    // Can't bind through an index, so have to do this in two parts
    firstMessage: O.bind( 'threadMessageList.0' ),
    subject: O.bind( 'firstMessage.subject', null, function ( val ) {
        return val || ( val === '' ? 'No Subject' : 'Loading…' );
    }),

    title: function () {
        var mailboxName = this.get( 'mailboxName' ),
            mailboxUnread = this.get( 'mailboxUnread' );
        return mailboxName +
            ( mailboxUnread ? ' (' + mailboxUnread + ')' : '' ) +
            ( this.get( 'firstMessage' ) ? ' – ' + this.get( 'subject' ) : '' );
    }.property( 'mailboxName', 'mailboxUnread', 'subject' ),

    // --- Selection ---

    selection: new O.SelectionController({
        content: O.bind( App, 'state*mailboxMessageList' ),
    }),

    // --- Initial data ---

    fetchInitialData: function () {
        store.fetchAll( Mailbox );
    },
});
JMAP.auth.addObserverForKey( 'isAuthenticated', App.state, 'fetchInitialData' );

rootMailboxes.addObserverForKey( '[]', {
    go: function ( rootMailboxes, key ) {
        rootMailboxes.removeObserverForKey( key, this, 'go' );
        App.state.set( 'mailbox',
            JMAP.mail.getMailboxForRole( null, 'inbox' ) );
    },
}, 'go' );

App.state.selectedMessage = new O.SingleSelectionController({
    content: O.bind( App.state, 'mailboxMessageList' ),
    record: O.bindTwoWay( App.state, 'emailId',
    function ( value, syncForward ) {
        return syncForward ?
            value ?
                store.getRecord( null, Message, value ) :
                null :
            value ?
                value.get( 'id' ) :
                '';
    }),
    updateThreadId: function () {
        var message = this.get( 'record' );
        if ( message ) {
            if ( message.is( O.Status.READY ) ) {
                App.state.set( 'thread', message.get( 'thread' ) );
            }
        } else {
            App.state.set( 'thread', null );
        }
    }.observes( 'record.status' ),

    setSelection: function () {
        var record = this.get( 'record' );
        var selection = App.state.selection;
        if ( record &&
                !selection.isStoreKeySelected( record.get( 'storeKey' ) ) ) {
            selection
                .selectNone()
                .selectStoreKeys( [ record.get( 'storeKey' ) ], true );
        }
    }.queue( 'before' ).observes( 'record', 'content' ),

    // ---

    _range: {
        start: -1,
        end: -1,
    },

    observeList: function ( _, __, oldList ) {
        var range = this._range,
            newList = App.state.get( 'mailboxMessageList' );
        if ( oldList ) {
            oldList.removeObserverForRange( range, this, 'setNextPrev' );
        }
        if ( newList ) {
            newList.addObserverForRange( range, this, 'setNextPrev' );
        }
        return this;
    }.observes( 'content' ),

    prev: null,
    next: null,

    setNextPrev: function () {
        var index = this.get( 'index' ),
            list = App.state.get( 'mailboxMessageList' ),
            range = this._range,
            prevIndex = index - 1,
            nextIndex = index + 1;

        // If message is no longer actually in list, then our index is really
        // the next message already.
        if ( index < 0 ||
                list && list.getObjectAt( index  ) !== this.get( 'record' ) ) {
            nextIndex = index;
        }

        // Monitor for changes to which message is next/previous in list
        range.start = prevIndex;
        range.end = nextIndex + 1;

        this.set( 'next', index < 0 || !list ? null :
                list.getObjectAt( nextIndex ) )
            .set( 'prev', index < 0 || !list ? null :
                list.getObjectAt( prevIndex ) );
    }.queue( 'middle' ).observes( 'index' ),
}).setSelection().observeList();

App.kbshortcuts = new O.GlobalKeyboardShortcuts();
App.kbshortcuts
    .register( 'j', App.state, 'goNext' )
    .register( 'k', App.state, 'goPrev' )
    .register( 'u', App.state, 'refresh' )
    .register( 'cmd-z', JMAP.mail.undoManager, 'undo' )
    .register( 'cmd-shift-z', JMAP.mail.undoManager, 'redo' )
    .register( 'cmd-a', App.state.selection, 'selectAll' );

// --- Connect to the push service ---

App.push = new O.EventSource({
    url: O.bind( JMAP.auth, 'eventSourceUrl' ),

    onStateChange: function ( event ) {
        var changed, accountId, accountChanges, Type, type;
        try {
            changed = JSON.parse( event.data ).changed;
        } catch ( error ) {
            O.RunLoop.didError({
                name: 'JMAP.EventSource#onStateChange',
                message: 'Invalid JSON',
                details: 'Arg:\n' + JSON.stringify( event ) + '\n\n',
            });
        }
        if ( !changed ) {
            return;
        }

        for ( accountId in changed ) {
            accountChanges = changed[ accountId ];
            for ( type in accountChanges ) {
                if ( type.startsWith( 'Email' ) ) {
                    type = type.replace( 'Email', 'Message' );
                }
                Type = JMAP[ type ];
                store.sourceStateDidChange(
                    accountId, Type, accountChanges[ type ] );
            }
        }
    }.on( 'state' ),

    openIfUrl: function () {
        if ( this.get( 'url' ) ) {
            this.open();
        }
        return this;
    }.observes( 'url' ),
}).openIfUrl();

// ---

App.credentials = new O.LocalStorage( 'credentials', false, {
    server: 'https://jmap.fastmail.com/.well-known/jmap',
    username: '',
    password: '',
});

App.credentials.login = function () {
    var server = this.get( 'server' );
    var username = this.get( 'username' );
    var password = this.get( 'password' );
    var accessToken = 'Basic ' + btoa( username + ':' + password );
    JMAP.auth.fetchSession( server, accessToken );
};

if ( App.credentials.get( 'username' ) && App.credentials.get( 'password' ) ) {
    App.credentials.login();
}

});
