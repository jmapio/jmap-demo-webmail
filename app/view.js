// -------------------------------------------------------------------------- \\
// File: views.js                                                             \\
// Module: Mail                                                               \\
// Requires: namespace.js, state.js, actions.js                               \\
// Author: Neil Jenkins                                                       \\
// License: © 2010–2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP, App */

"use strict";

O.RunLoop.invoke( function () {

App.views = {
    mainWindow: new O.RootView( document )
};

var EmptyView = O.Class({
    Extends: O.LabelView,
    layerTag: 'h1',
    className: 'v-Empty',
    positioning: 'absolute'
});

var sidebarSplitController = new O.SplitViewController({
    flex: O.SplitViewController.BOTTOM_RIGHT,
    staticPaneLength: 180,
    minStaticPaneLength: 150,
    maxStaticPaneLength: Math.max( 320 )
});

var contentSplitController = new O.SplitViewController({
    flex: O.SplitViewController.BOTTOM_RIGHT,
    staticPaneLength: 320,
    minStaticPaneLength: 250,
    maxStaticPaneLength: Math.max( 500,
        App.views.mainWindow.get( 'pxWidth' ) - 700 )
});

var mailboxView = new O.ScrollView({
    className: 'app-list',
    layout: O.bind( contentSplitController, 'topLeftLayout' ),
    childViews: [
        new O.SwitchView({
            index: O.bind( App.state, 'mailboxMessageList.length',
                function ( length ) {
                    return length ? 2 :
                        ( length === 0 ) ? 1 : 0;
                }),
            views: [
                new EmptyView({
                    value: 'Loading…'
                }),
                new EmptyView({
                    value: 'No Conversations'
                }),
                new O.ProgressiveListView({
                    content: O.bind( App.state, 'mailboxMessageList' ),
                    ItemView: App.MailboxItemView,
                    itemHeight: 96,
                    selection: App.state.selection,
                    destroyItemView: function () {}
                })
            ]
        })
    ],
    selectNone: function () {
        App.state.selection.selectAll( false );
        App.state.selectedMessage.set( 'record', null );
    }.on( 'click' )
});

var threadView = new O.ScrollView({
    className: 'app-content',
    layout: O.bind( contentSplitController, 'bottomRightLayout' ),
    showScrollbarX: true,
    keys: {
        'pagedown': 'scrollPage',
        'pageup': 'reverseScrollPage',
        'space': 'scrollPage',
        'shift-space': 'reverseScrollPage',
        'down': 'scrollLine',
        'up': 'reverseScrollLine'
    },
    childViews: [
        new O.SwitchView({
            list: O.bind( App.state, 'threadMessageList' ),
            length: O.bind( 'list.length' ),
            hasSelection: O.bind( App.state.selection, 'length',
                function ( length ) {
                    return length > 1;
                }),
            index: function () {
                return this.get( 'hasSelection' ) ? 3 :
                    this.get( 'list' ) ? this.get( 'length' ) ? 2 : 0 : 1;
            }.property( 'list', 'length', 'hasSelection' ),
            views: [
                new EmptyView({
                    value: 'Loading…'
                }),
                new EmptyView({
                    value: 'No Conversation Selected'
                }),
                new O.View({
                    className: 'v-Thread',
                    childViews: [
                        new O.LabelView({
                            allowTextSelection: true,
                            layerTag: 'h1',
                            className: 'v-Thread-title',
                            value: O.bind( App.state, 'subject' )
                        }),
                        new O.ListView({
                            content: O.bind( App.state, 'threadMessageList' ),
                            ItemView: App.ThreadMessageView
                        })
                    ]
                }),
                new O.LabelView({
                    layerTag: 'h1',
                    className: 'v-Empty',
                    positioning: 'absolute',
                    value: O.bind( App.state.selection, 'length',
                    function ( length ) {
                        return length + ' Conversations Selected';
                    })
                })
            ]
        })
    ]
});

var main = new O.View({
    positioning: 'absolute',
    layout: O.bind( sidebarSplitController, 'bottomRightLayout' ),
    childViews: [
        new O.View({
            positioning: 'absolute',
            className: 'app-toolbar',
            layout: {
                top: 0,
                left: 0,
                right: 0,
                height: 50
            },
            childViews: [
                new O.View({
                    className: 'v-MailboxTitle',
                    positioning: 'absolute',
                    layout: O.bind( contentSplitController, 'topLeftLayout' ),
                    draw: function ( layer, Element, el ) {
                        return [
                            el( 'div.v-MailboxTitle-name', {
                                text: O.bind( App.state, 'mailboxName' )
                            }),
                            el( 'div.v-MailboxTitle-total', {
                                text: O.bind( App.state,
                                    'mailboxMessageList.length',
                                function ( total ) {
                                    return total != null ? total + '' : '';
                                })
                            })
                        ];
                    }
                }),
                new O.View({
                    className: 'v-Toolbar',
                    positioning: 'absolute',
                    layout:
                        O.bind( contentSplitController, 'bottomRightLayout' ),
                    draw: function () {
                        return [
                            new O.ButtonView({
                                label: 'Archive',
                                target: App.actions,
                                method: 'archive'
                            }),
                            new O.ButtonView({
                                label: 'Delete',
                                target: App.actions,
                                method: 'deleteToTrash'
                            }),
                            new O.ButtonView({
                                label: 'Mark as Read',
                                target: App.actions,
                                method: 'read'
                            }),
                            new O.ButtonView({
                                label: 'Mark as Unread',
                                target: App.actions,
                                method: 'unread'
                            }),
                            new O.ButtonView({
                                label: 'Undo',
                                target: JMAP.mail.undoManager,
                                method: 'undo'
                            })
                        ];
                    }
                })
            ]
        }),
        new O.View({
            positioning: 'absolute',
            layout: O.extend({
                top: 50
            }, O.View.LAYOUT_FILL_PARENT, true ),
            childViews: [
                mailboxView,
                threadView,
                new O.SplitDividerView({
                    controller: contentSplitController
                })
            ]
        })
    ]
});

var sidebar = new O.View({
    positioning: 'absolute',
    layout: O.bind( sidebarSplitController, 'topLeftLayout' ),
    childViews: [
        new O.View({
            positioning: 'absolute',
            className: 'app-toolbar',
            layout: {
                top: 0,
                left: 0,
                right: 0,
                height: 50
            },
            draw: function ( layer, Element, el ) {
                return el( 'div.v-MailboxTitle', { style: 'display:block' }, [
                    el( 'b', { style: 'font-weight:600' }, [ 'JMAP' ]),
                    ' / Mail'
                ]);
            }
        }),
        new O.View({
            className: 'v-Sidebar',
            positioning: 'absolute',
            layout: O.extend({
                top: 50
            }, O.View.LAYOUT_FILL_PARENT, true ),
            childViews: [
                new O.ListView({
                    content: JMAP.mail.allMailboxes,
                    ItemView: App.MailboxSourceView
                })
            ]
        })
    ]
});

App.views.mail = new O.View({
    positioning: 'absolute',
    layout: O.View.LAYOUT_FILL_PARENT,
    childViews: [
        main,
        sidebar,
        new O.SplitDividerView({
            controller: sidebarSplitController
        })
    ]
});

App.views.mainWindow.insertView( App.views.mail );

});
