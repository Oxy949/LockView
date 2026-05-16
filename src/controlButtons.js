import { moduleName } from "../lockview.js";
import { Helpers } from "./helpers.js";

export function initializeControlButtons() {
    Hooks.on('getSceneControlButtons', controls => {
        const visibleControlButtons = game.settings.get(moduleName, "controlButtons");
        const useDummyTool = (game.release?.generation ?? Number(game.version?.split(".")[0]) ?? 0) < 14;

        controls.lockView = {
            name: "lockView",
            title: "Lock View",
            icon: "fas fa-tv",
            order: 100,
            visible: Helpers.getUserSetting('control') && visibleControlButtons?.enable,
            tools: {
                setView: {
                    name: "setView",
                    title: game.i18n.localize("LOCKVIEW.ControlButtons.SetView"),
                    icon: "fas fa-compress-arrows-alt",
                    visible: visibleControlButtons?.setView ?? true,
                    button: true,
                    order: 0,
                    onChange: () => lockView.apps.setView.render(true)
                },
                cloneView: {
                    name: "cloneView",
                    title: game.i18n.localize("LOCKVIEW.ControlButtons.CloneView"),
                    icon: "fas fa-clone",
                    visible: visibleControlButtons?.cloneView ?? true,
                    button: true,
                    order: 1,
                    onChange: () => lockView.apps.cloneView.apply()
                },
                resetView: {
                    name: "resetView",
                    title: game.i18n.localize("LOCKVIEW.ControlButtons.ResetView"),
                    icon: "fas fa-rotate-left",
                    visible: visibleControlButtons?.resetView ?? true,
                    button: true,
                    order: 1,
                    onChange: () => {
                        lockView.socket.refresh();
                    }
                },
                panLock: {
                    name: "panLock",
                    title: game.i18n.localize("LOCKVIEW.ControlButtons.PanLock"),
                    icon: "fas fa-arrows-alt",
                    visible: visibleControlButtons?.panLock ?? true,
                    order: 2,
                    onChange: (event, active) => {
                        lockView.locks.update({pan: active}, {save: true})
                    },
                    toggle: true,
                    active: lockView?.locks?.pan || false
                },
                zoomLock: {
                    name: "zoomLock",
                    title: game.i18n.localize("LOCKVIEW.ControlButtons.ZoomLock"),
                    icon: "fas fa-search-plus",
                    visible: visibleControlButtons?.zoomLock ?? true,
                    order: 3,
                    onChange: (event, active) => {
                        lockView.locks.update({zoom: active}, {save: true})
                    },
                    toggle: true,
                    active: lockView?.locks?.zoom || false
                },
                boundingBox: {
                    name: "boundingBox",
                    title: game.i18n.localize("LOCKVIEW.ControlButtons.BoundingBox"),
                    icon: "fas fa-box",
                    visible: visibleControlButtons?.boundingBox ?? true,
                    order: 4,
                    onChange: (event, active) => {
                        lockView.locks.update({boundingBox: active}, {save: true})
                    },
                    toggle: true,
                    active: lockView?.locks?.boundingBox || false
                },
                viewbox: {
                    name: "viewbox",
                    title: game.i18n.localize("LOCKVIEW.ControlButtons.Viewbox"),
                    icon: "far fa-square",
                    visible: visibleControlButtons?.viewbox ?? true,
                    order: 5,
                    onChange: async (event, active) => {
                        lockView.viewbox.enable(active);
                        if (!active) {
                            lockView.viewbox.enableEdit(false);
                            Helpers.setControlToolActive('editViewbox', false);
                            Helpers.renderControls();
                        }
                    },
                    toggle: true,
                    active: lockView?.viewbox?.enabled ?? false
                },
                editViewbox: {
                    name: "editViewbox",
                    title: game.i18n.localize("LOCKVIEW.ControlButtons.EditViewbox"),
                    icon: "fas fa-vector-square",
                    visible: visibleControlButtons?.editViewbox ?? true,
                    order: 6,
                    onChange: (event, active) => {
                        if (active && !lockView.viewbox.enabled) {
                            lockView.viewbox.enable(true);
                            Helpers.setControlToolActive('viewbox', true);
                            Helpers.renderControls();
                        }
                        lockView.viewbox.enableEdit(active);
                    },
                    toggle: true,
                    active: lockView?.viewbox?.editEnabled ?? false
                },
            },
        }

        if (useDummyTool) {
            controls.lockView.activeTool = "dummy";
            controls.lockView.tools.dummy = {
                name: "dummy",
                title: "Lock View",
                icon: "fas fa-tv",
                visible: true,
                order: 9
            };
        }
    });

    Hooks.on('renderSceneControls', () => {
        const visibleControlButtons = game.settings.get(moduleName, "controlButtons");
        
        if (!visibleControlButtons?.enable || !Helpers.getUserSetting('control')) {
            document.querySelector('button[data-control="lockView"]')?.parentElement?.style.setProperty('display', 'none');
            if (ui.controls.control?.name === "lockView")
                ui.controls.activate({control: "tokens"}) 
            return;
        }
        if (ui.controls.control?.name !== 'lockView') {
            lockView.viewbox.enableEdit(false);
            Helpers.setControlToolActive('editViewbox', false);
        }
        else {
            const toolElements = document.getElementById("scene-controls-tools");
            toolElements?.querySelector('button[data-tool="dummy"]')?.parentElement?.style.setProperty('display', 'none');
        }

        document.querySelector('button[data-tool="cloneView"]')?.addEventListener('contextmenu', (ev) => {
            lockView.apps.cloneView.render(true);
        })
    })
}
