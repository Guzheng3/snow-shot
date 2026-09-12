import type { GlobalToken } from "antd";

export const getOcrResultIframeSrcDoc = (
	textContent: string,
	enableDrag: boolean | undefined,
	enableCopy: boolean | undefined,
	_token: GlobalToken | undefined,
) => {
	return `<head><meta name="color-scheme" content="light dark"></meta></head>
                                <body>${textContent}</body>
                        <style>
                            html {
                                height: 100%;
                                width: 100%;
                                background-color: transparent;
                            }

                            .ocr-result-text-background-element {
                                opacity: 0;
                            }

                            .ocr-result-text-element {
                                opacity: 1;
                            }

                            body {
                                height: 100%;
                                width: 100%;
                                padding: 0;
                                margin: 0;
                                border: none;
                                overflow: hidden;
                                ${enableDrag ? "cursor: grab;" : ""}
                                background-color: transparent;
                            }
                            body:active {
                                ${enableDrag ? "cursor: grabbing;" : ""}
                            }

                            * {
                                -webkit-user-select: text !important;
                                -moz-user-select: text !important;
                                -ms-user-select: text !important;
                                user-select: text !important;
                            }
                        </style>
                        <script>
                            document.oncopy = (e) => {
                                if (${enableCopy ? "true" : "false"}) {
                                    return;
                                }

                                e.preventDefault();
                            };

                            document.oncontextmenu = (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                window.parent.postMessage({
                                    type: 'contextMenu',
                                    eventData: {
                                        type: 'contextmenu',
                                        clientX: e.clientX,
                                        clientY: e.clientY,
                                    }
                                }, '*');
                            };

                            document.addEventListener('mousedown', (e) => {
                                window.parent.postMessage({
                                    type: 'mousedown',
                                    clientX: e.clientX,
                                    clientY: e.clientY,
                                    button: e.button,
                                    buttons: e.buttons,
                                    ctrlKey: e.ctrlKey,
                                    shiftKey: e.shiftKey,
                                    altKey: e.altKey,
                                    metaKey: e.metaKey,
                                }, '*');
                            });

                            document.addEventListener('wheel', (e) => {
                                e.preventDefault();
                                window.parent.postMessage({
                                    type: 'wheel',
                                    eventData: {
                                        deltaY: e.deltaY,
                                        clientX: e.clientX,
                                        clientY: e.clientY,
                                        ctrlKey: e.ctrlKey,
                                        shiftKey: e.shiftKey,
                                        altKey: e.altKey,
                                    },
                                }, '*');
                            });

                            document.addEventListener('mousemove', (e) => {
                                window.parent.postMessage({
                                    type: 'mousemove',
                                    clientX: e.clientX,
                                    clientY: e.clientY,
                                    button: e.button,
                                    buttons: e.buttons,
                                    ctrlKey: e.ctrlKey,
                                    shiftKey: e.shiftKey,
                                    altKey: e.altKey,
                                    metaKey: e.metaKey,
                                }, '*');
                            });

                            document.onmouseup = (e) => {
                                window.parent.postMessage({
                                    type: 'mouseup',
                                    clientX: e.clientX,
                                    clientY: e.clientY,
                                    button: e.button,
                                    buttons: e.buttons,
                                    ctrlKey: e.ctrlKey,
                                    shiftKey: e.shiftKey,
                                    altKey: e.altKey,
                                    metaKey: e.metaKey,
                                }, '*');
                            };

                            // 转发键盘事件到父窗口
                            document.onkeydown = (e) => {
                                window.parent.postMessage({
                                    type: 'keydown',
                                    key: e.key,
                                    code: e.code,
                                    keyCode: e.keyCode,
                                    ctrlKey: e.ctrlKey,
                                    shiftKey: e.shiftKey,
                                    altKey: e.altKey,
                                    metaKey: e.metaKey,
                                    repeat: e.repeat,
                                }, '*');
                            };

                            document.onkeyup = (e) => {
                                window.parent.postMessage({
                                    type: 'keyup',
                                    key: e.key,
                                    code: e.code,
                                    keyCode: e.keyCode,
                                    ctrlKey: e.ctrlKey,
                                    shiftKey: e.shiftKey,
                                    altKey: e.altKey,
                                    metaKey: e.metaKey,
                                }, '*');
                            };
                        </script>
                    `;
};
