# Tab Volume - Firefox Extension

**Tab Volume** is a simple Firefox extension for setting and saving volume levels on a per-site basis.  
It controls both standard HTML media elements (`<video>`, `<audio>`) and audio routed through the **Web Audio API**.

The volume you set for a specific site (e.g., `youtube.com`) will be saved and automatically applied every time you visit that site.

---

## 🚀 Installation

1. **Download** the repository as a ZIP file and unzip it to a permanent location on your computer.  
2. Open Firefox and navigate to: `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on...**.  
4. Browse to the unzipped folder and select the `manifest.json` file.  

The extension is now installed and will remain active until you close Firefox.  

---

## 🎛️ How to Use

1. Navigate to a website with audio or video content.  
2. Click the extension’s **jester-hat volume icon** in the toolbar to open the popup.  
3. Adjust the slider to set your desired volume for that site.  
4. The volume is saved automatically and will be applied to all current and future tabs you open for that site.  

---

## 🖼️ Icon

The extension uses a custom **volume icon with a jester hat** 🎭🔊 to stand out in your toolbar.

---

## ⚠️ Notes

- Works on most sites that use `<video>`, `<audio>`, or Web Audio API.  
- For livestreams and custom players, the extension enforces your chosen volume continuously to override site-specific volume controls.  
- As this is a temporary add-on, you’ll need to reload it after restarting Firefox unless you submit it for signing.
