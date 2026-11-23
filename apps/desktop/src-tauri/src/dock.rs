//! The Dock menu (macOS): the sites most recently opened, newest first.
//! Choosing one shows it in the window you were last in.
//!
//! Tauri has no Dock-menu API, so the app delegate is given an
//! `applicationDockMenu:` method that returns a menu built with muda — the
//! same menu library behind the app's own menus — so a click arrives in
//! `menu::handle` like any other menu item ("recent:<id>"). The menu is
//! rebuilt with the File › Open recent list (menu::refresh_soon), always on
//! the main thread, which is also where AppKit asks for it.

use muda::{ContextMenu, Menu, MenuItem};
use objc2::{
    ffi::class_addMethod,
    msg_send,
    runtime::{AnyClass, AnyObject, Imp, Sel},
    sel,
};
use std::{
    cell::RefCell,
    ffi::c_void,
    sync::{
        atomic::{AtomicBool, AtomicPtr, Ordering},
    },
};
use tauri::AppHandle;

thread_local! {
    /// The muda menu behind the native one; dropping it would free the NSMenu AppKit is handed.
    static MENU: RefCell<Option<Menu>> = const { RefCell::new(None) };
}
static NATIVE: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
static INSTALLED: AtomicBool = AtomicBool::new(false);

extern "C-unwind" fn dock_menu(_this: *mut AnyObject, _cmd: Sel, _sender: *mut AnyObject) -> *mut AnyObject {
    NATIVE.load(Ordering::SeqCst).cast()
}

/// Gives the app delegate its `applicationDockMenu:`. Once; main thread only.
fn install() {
    if INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }
    // SAFETY: called on the main thread after the app finished launching, so
    // NSApplication and its delegate exist; the method is added to the
    // delegate's own class (it has none of that name), with the type encoding
    // of `- (NSMenu *)applicationDockMenu:(NSApplication *)sender`.
    unsafe {
        let Some(application) = AnyClass::get(c"NSApplication") else {
            return;
        };
        let app: *mut AnyObject = msg_send![application, sharedApplication];
        if app.is_null() {
            return;
        }
        let delegate: *mut AnyObject = msg_send![app, delegate];
        if delegate.is_null() {
            return;
        }
        let class = (*delegate).class();
        let imp: Imp = std::mem::transmute::<extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> *mut AnyObject, Imp>(dock_menu);

        class_addMethod((class as *const AnyClass).cast_mut(), sel!(applicationDockMenu:), imp, c"@@:@".as_ptr());
    }
}

/// Rebuilds the Dock menu from the recent sites. Call on the main thread.
pub fn set_recent(_app: &AppHandle, recent: &[(String, String)]) {
    let menu = Menu::new();

    for (id, name) in recent {
        let _ = menu.append(&MenuItem::with_id(format!("recent:{id}"), name, true, None));
    }
    if recent.is_empty() {
        let _ = menu.append(&MenuItem::with_id("recent-none", "No recent sites", false, None));
    }
    NATIVE.store(menu.ns_menu(), Ordering::SeqCst);
    MENU.with(|slot| *slot.borrow_mut() = Some(menu));
    install();
}
