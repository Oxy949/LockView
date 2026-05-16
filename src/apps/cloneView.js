import { Helpers } from "../helpers.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

function localize(str, category="CloneView") {
    return Helpers.localize(str, category)
}

export class CloneView extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "lockView-cloneView",
        tag: "div",
        position: {
            width: 300
        },
        window: {
            contentClasses: ["standard-form"],
            icon: "fas fa-clone",
            controls: [
                {
                    icon: 'fas fa-circle-info',
                    label: "LOCKVIEW.Help",
                    action: "openDocumentation",
                },
              ]
        },
        actions: {
            openDocumentation: CloneView.openDocumentation
        }
    }

    static PARTS = {
        form: {
            template: "./modules/LockView/templates/cloneView.hbs",
            scrollable: [""]
          }
    }

    get title() {
        return "Lock View: " + localize("Title");
    }

    static openDocumentation() {
        window.open(Helpers.getDocumentationUrl('moduleSettings/cloneViewConfigurator/'))
    }

    pan = true;
    zoom = true;
    users = {};
    showDialog = true;

    async apply(pan = this.pan, zoom = this.zoom, users) {
        if (!Helpers.getUserSetting('control')) 
            return ui.notifications.warn("Lock View: " + Helpers.localize("NoPermission", "Notifications"));
        if (!users) {
            users = {};
            for (let user of game.users) {
                const userId = user.id;
                if (userId === game.userId) continue;
                if (user.viewedScene !== canvas.scene.id) continue;
                if (this.users[userId] !== undefined)
                    users[userId] = this.users[userId];
                else {
                    users[userId] = Helpers.getUserSetting('enable', userId);
                }
            }
        }

        if (this.showDialog && (pan && lockView.locks.pan || zoom && lockView.locks.zoom)) {
            const fields = foundry.applications.fields;
            const cb = fields.createCheckboxInput({
                name: 'doNotShowAgain',
                value: false
            })
            
            const formGroup = fields.createFormGroup({
                input: cb,
                label: localize("DoNotShowAgain")
            })

            let showDialog = true;
            const dialog = await foundry.applications.api.DialogV2.confirm({
                window: { title: localize("Title") },
                content: `<p>${localize("DialogContent")}</p>${formGroup.outerHTML}`,
                render: (context, options) => {
                    options.element.querySelector('input[name="doNotShowAgain"]').addEventListener('change', (ev) => showDialog = !ev.target.checked);
                }
            })

            this.showDialog = showDialog;
            if (!dialog) return;
        }
        
        let u = [];
        Object.entries(users).forEach(([id, val]) => {
            if (val) u.push(id);
        })

        const viewPosition = Helpers.getViewPosition();
        lockView.socket.setViewDialog({
            pan: pan ? 'cloneView' : 'noChange',
            coordinates: {
                x: viewPosition.x,
                y: viewPosition.y
            },
            zoom: zoom ? 'cloneView' : undefined,
            scale: viewPosition.scale
        }, u)
    }

    //Prepare data to be handled
    async _prepareContext(options) {

        let users = [];
        for (let user of game.users) {
            const userId = user.id;
            if (userId === game.userId) continue;
            if (user.viewedScene !== canvas.scene.id) continue;
            let initial;
            if (this.users[userId] !== undefined)
                initial = this.users[userId];
            else {
                initial = Helpers.getUserSetting('enable', userId);
                this.users[userId] = initial;
            }
            users.push(new foundry.data.fields.BooleanField({label: user.name, initial}, {name: `users.${userId}`}))
        }

        return {
            pan: new foundry.data.fields.BooleanField({label: localize('Pan'), initial: this.pan}, {name: 'pan'}),
            zoom: new foundry.data.fields.BooleanField({label: localize('Zoom'), initial: this.zoom}, {name: 'zoom'}),
            users
        }
    }

    _onRender(context, options) {
        this.element.querySelector('input[name="pan"]').addEventListener('change', (ev) => this.pan = ev.target.checked);
        this.element.querySelector('input[name="zoom"]').addEventListener('change', (ev) => this.zoom = ev.target.checked);
        Object.entries(this.users).forEach(([id, val]) => {
            this.element.querySelector(`input[name="users.${id}"]`).addEventListener('change', (ev) => this.users[id] = ev.target.checked);
        })
    }
}
