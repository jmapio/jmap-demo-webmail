// -------------------------------------------------------------------------- \\
// File: state.js                                                             \\
// Module: Mail                                                               \\
// Requires: namespace.js                                                     \\
// Author: Neil Jenkins                                                       \\
// License: © 2010–2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, App, JMAP */

"use strict";

O.RunLoop.invoke( function () {

// ==== State ====

var Status = O.Status,
    LOADING = Status.LOADING,
    EMPTY_OR_OBSOLETE = Status.EMPTY | Status.OBSOLETE;

App.state = new O.Router({

    useHash: true,

    routes: [
        // Selected conversation
        {
            url: /^(.+)$/,
            handle: function ( _, messageId ) {
                this.selection.selectAll( false );
                this.beginPropertyChanges()
                    .set( 'messageId', messageId )
                    .endPropertyChanges();
            }
        },
        // Default
        {
            url: /.*/,
            handle: function () {
                this.selection.selectAll( false );
                this.beginPropertyChanges()
                    .set( 'messageId', '' )
                    .endPropertyChanges();
            }
        }
    ],

    encodedState: function () {
        return this.get( 'messageId' );
    }.property( 'messageId' ),

    // ---

    mailboxId: O.bind( JMAP.mail.systemMailboxIds, 'inbox' ),
    threadId: '',
    messageId: '',

    mailbox: function () {
        var id = this.get( 'mailboxId' );
        return id ? JMAP.store.getRecord( JMAP.Mailbox, id ) : null;
    }.property( 'mailboxId' ),

    mailboxMessageList: function () {
        var mailboxId = this.get( 'mailboxId' );
        if ( !mailboxId ) {
            return null;
        }
        var args = {
            filter: { inMailboxes: [ mailboxId ] },
            sort: [ 'date desc' ],
            collapseThreads: true
        };
        var id = JMAP.MessageList.getId( args );
        return JMAP.store.getQuery( id, JMAP.MessageList, args );
    }.property( 'mailboxId' ),

    mailboxMessageListStatusDidChange: function ( _, __, ___, status ) {
        if ( status &&
                ( status & EMPTY_OR_OBSOLETE ) && !( status & LOADING ) ) {
            this.get( 'mailboxMessageList' ).refresh( false );
        }
    }.observes( 'mailboxMessageList.status' ),

    thread: function () {
        var id = this.get( 'threadId' );
        return id ? JMAP.store.getRecord( JMAP.Thread, id ) : null;
    }.property( 'threadId' ),

    threadStatusDidChange: function ( thread, __, ___, status ) {
        if ( status ) {
            if ( ( status & EMPTY_OR_OBSOLETE ) && !( status & LOADING ) ) {
                thread.refresh();
            }
        }
    }.observes( 'thread.status' ),

    threadMessageList: function () {
        var threadId = this.get( 'threadId' );
        return threadId ?
            JMAP.store.getRecord( JMAP.Thread, threadId ).get( 'messages' ) :
            null;
    }.property( 'threadId' ),

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
        JMAP.store.fetchAll( JMAP.Mailbox, true )
                  .fetchAll( JMAP.Message, true )
                  .fetchAll( JMAP.Thread, true );
    },

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
        content: O.bind( App, 'state*mailboxMessageList' )
    })
});

App.state.selectedMessage = new O.SingleSelectionController({
    content: O.bind( App.state, 'mailboxMessageList' ),
    record: O.bindTwoWay( App.state, 'messageId',
    function ( value, syncForward ) {
        return syncForward ?
            value ?
                JMAP.store.getRecord( JMAP.Message, value ) :
                null :
            value ?
                value.get( 'id' ) :
                '';
    }),
    updateThreadId: function () {
        var message = this.get( 'record' );
        if ( message ) {
            if ( message.is( O.Status.READY ) ) {
                App.state.set( 'threadId', message.get( 'threadId' ) );
            }
        } else {
            App.state.set( 'threadId', '' );
        }
    }.observes( 'record.status' ),

    setSelection: function () {
        var record = this.get( 'record' );
        if ( record &&
                !App.state.selection.isIdSelected( record.get( 'id' ) ) ) {
            App.state.selection
                .selectAll( false )
                .selectIds( [ record.get( 'id' ) ], true );
        }
    }.queue( 'before' ).observes( 'record', 'content' ),

    // ---

    _range: {
        start: -1,
        end: -1
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
    }.queue( 'middle' ).observes( 'index' )
}).setSelection().observeList();

App.kbshortcuts = new O.GlobalKeyboardShortcuts();
App.kbshortcuts
    .register( 'j', App.state, 'goNext' )
    .register( 'k', App.state, 'goPrev' )
    .register( 'u', App.state, 'refresh' )
    .register( 'cmd-z', JMAP.mail.undoManager, 'undo' )
    .register( 'cmd-shift-z', JMAP.mail.undoManager, 'redo' )
    .register( 'cmd-a', App.state.selection, 'selectAll' );

// --- Temp hack to talk to proxy without implementing proper auth ---

var userPath = ( /k=([0-9a-f\-]+)/.exec( location.href ) || [ '', '' ] )[1];
JMAP.auth.didAuthenticate( '', '', {
    apiUrl: 'https://proxy.jmap.io/jmap/' + userPath,
    eventSourceUrl: 'https://proxy.jmap.io/events/' + userPath,
    uploadUrl: 'https://proxy.jmap.io/upload/' + userPath,
    downloadUrl: 'https://proxy.jmap.io/raw/' + userPath + '/{blobId}/{name}'
});

// --- Connect to the push service ---

App.push = new O.EventSource({
    url: function () {
        return JMAP.auth.get( 'eventSourceUrl' );
    }.property().nocache(),

    onStateChange: function ( event ) {
        var changed, accountId, accountState, type;
        try {
            changed = JSON.parse( event.data ).changed;
        } catch ( error ) {
            O.RunLoop.didError({
                name: 'JMAP.EventSource#onStateChange',
                message: 'Invalid JSON',
                details: 'Arg:\n' + JSON.stringify( event ) + '\n\n'
            });
        }
        if ( !changed ) {
            return;
        }

        for ( accountId in changed ) {
            accountState = changed[ accountId ];
            for ( type in accountState ) {
                JMAP.store.sourceStateDidChange(
                    JMAP[ type ], accountState[ type ] );
            }
        }
    }.on( 'state' )
}).open();

});
