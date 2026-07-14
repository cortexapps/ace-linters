import * as ace from "ace-code";
import {Ace} from "ace-code";
import "ace-code/src/test/mockdom";
//@ts-ignore
window["self"] = {};

import {LanguageProvider} from "../../src/language-provider";
import {SignatureTooltip} from "../../src/components/signature-tooltip";
import {Mode as HtmlMode} from "ace-code/src/mode/html";
import {expect} from "chai";
import {MockWorker} from "../../src/misc/mock-worker";
import {ServiceManager} from "../../src/services/service-manager";

describe('Destroyed editor/session safety', () => {
    let editor: Ace.Editor;
    let languageProvider: LanguageProvider;
    let client: MockWorker, ctx: MockWorker;

    beforeEach((done) => {
        client = new MockWorker();
        ctx = new MockWorker();
        client.setEmitter(ctx);
        ctx.setEmitter(client);

        let manager = new ServiceManager(ctx);
        manager.registerService("html", {
            features: {completion: true, completionResolve: true, diagnostics: true, format: true, hover: true},
            module: () => import("../../src/services/html/html-service"),
            className: "HtmlService",
            modes: "html"
        });

        languageProvider = LanguageProvider.create(client, {
            functionality: {
                hover: true,
                completion: {
                    overwriteCompleters: true
                },
                completionResolve: true,
                format: true,
                documentHighlights: false,
                signatureHelp: false
            }
        });

        editor = ace.edit(document.createElement('div'), {
            value: "<h1>Juhu Kinners</h1>",
            mode: new HtmlMode()
        });

        // wait for the worker handshake before tests start destroying editors,
        // so no late $connected callback fires into a torn-down test
        let onAnnotation = () => {
            editor.session.off("changeAnnotation", onAnnotation);
            done();
        };
        editor.session.on("changeAnnotation", onAnnotation);

        languageProvider.registerEditor(editor);
    });

    // NB: assertions in this suite compare scalars (messages, ids) rather than
    // editor/session objects — chai's inspection of a full editor graph in a
    // failure message exhausts the heap.
    it('getTokenAt should not throw after the editor is destroyed', () => {
        let session = editor.session;
        // sanity check: tokenization works while the session is alive
        let thrownBefore: unknown;
        try {
            session.getTokenAt(0, 1);
        } catch (error) {
            thrownBefore = error;
        }
        expect(String(thrownBefore ?? "")).to.equal("");

        // react wrappers destroy the editor on unmount; this nulls bgTokenizer.doc
        editor.destroy();

        // async consumers (e.g. signature help callbacks) may still hold the session
        let thrownAfter: unknown;
        try {
            session.getTokenAt(0, 1);
        } catch (error) {
            thrownAfter = error;
        }
        expect(String(thrownAfter ?? "")).to.equal("");
    });

    it('SignatureTooltip.update should switch the active editor while the tooltip is open', () => {
        let tooltip = new SignatureTooltip(languageProvider);
        let otherEditor = ace.edit(document.createElement('div'), {
            value: "<p>other</p>",
            mode: new HtmlMode()
        });

        tooltip.$activateEditor(editor);
        tooltip.isOpen = true;

        // selection changed in another editor (e.g. the old one was unmounted and replaced)
        tooltip.update(otherEditor);

        expect(tooltip.$activeEditor?.id).to.equal(otherEditor.id);

        tooltip.isOpen = false;
        otherEditor.destroy();
    });

    it('SignatureTooltip.provideSignatureHelp should not request help for a destroyed editor', () => {
        let tooltip = new SignatureTooltip(languageProvider);
        languageProvider.options.functionality!.signatureHelp = true;

        let requested = false;
        //@ts-ignore
        languageProvider.provideSignatureHelp = () => {
            requested = true;
        };

        tooltip.$activateEditor(editor);
        editor.destroy();

        expect(() => tooltip.provideSignatureHelp()).to.not.throw();
        expect(requested).to.equal(false);
    });

    afterEach(() => {
        if (!editor.session?.destroyed) {
            editor.destroy();
        }
        editor.container.remove();
    });
});
