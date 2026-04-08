// 在主进程中.
const { ipcMain } = require('electron');
const { dialog } = require('electron');
const fse = require('fs-extra');
const fs = require('fs');
const sharp = require('sharp');
const request = require('superagent');
const path = require('path');
import { getHeader } from './ipHandle';

ipcMain.handle('show-dialog', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile', 'openDirectory'] });
  return result;
});
// 确保目录存在，不存在则创建
ipcMain.on('ensure-dir', (event, args) => {
  fse.ensureDirSync(args);
});


// 下载事件
// eslint-disable-next-line no-unused-vars
export function ipcHandle(_win) {

  // superagent & sharp 下载图片 - Promise 化处理
  ipcMain.handle('save-image', async (event, args) => {
    const savePath = path.normalize(args.savePath);
    const sharpStream = sharp({
      failOnError: false,
    });
    const promises = [];

    return new Promise((resolve) => {
      if (args.imageBuffer) {
        const base64Data = args.imageBuffer.replace(/^data:image\/\w+;base64,/, '');
        const dataBuffer = Buffer.from(base64Data, 'base64');
        promises.push(
          sharpStream
            .composite([{ input: dataBuffer, gravity: 'centre', blend: 'dest-in' }])
            .toFile(savePath),
        );
      } else {
        promises.push(
          sharpStream
            .toFile(savePath),
        );
      }

      const req = request.get(args.url).set(getHeader());
      const stream = req.pipe(sharpStream);

      stream.on('finish', () => {
        Promise.all(promises)
          .then(() => {
            resolve({ success: true });
          })
          .catch((err) => {
            console.error('保存图片错误', err);
            try {
              fs.unlinkSync(savePath);
            } catch {
              // do nothing
            }
            resolve({ success: false, error: err.message });
          });
      });

      stream.on('error', (err) => {
        console.error('下载流错误', err);
        try {
          fs.unlinkSync(savePath);
        } catch {
          // do nothing
        }
        req.abort();
        resolve({ success: false, error: err.message });
      });

      req.on('error', (err) => {
        console.error('请求错误', err);
        try {
          fs.unlinkSync(savePath);
        } catch {
          // do nothing
        }
        resolve({ success: false, error: err.message });
      });
    });
  });

  // superagent & sharp 下载、合并图片 - Promise 化处理
  ipcMain.handle('save-image-merge', async (event, args) => {
    try {
      const savePath = path.normalize(args.savePath);
      let imgBack;
      const imgBuffer = [];
      const layers = args.layers;

      for (let index = 0; index < layers.length; index++) {
        const item = layers[index];
        const sharpStream = sharp({
          failOnError: false,
        });

        const bff = await new Promise((resolve, reject) => {
          const req = request.get(args.url).set(getHeader());
          const stream = req.pipe(sharpStream);

          stream.on('finish', () => {
            sharpStream.toBuffer()
              .then(resolve)
              .catch(reject);
          });

          stream.on('error', reject);
          req.on('error', reject);
        });

        if (item.isLabel) {
          imgBack = bff;
        } else {
          imgBuffer.push(bff);
        }
      }

      let operation;
      if (args.imageBuffer) {
        const base64Data = args.imageBuffer.replace(/^data:image\/\w+;base64,/, '');
        const dataBuffer = Buffer.from(base64Data, 'base64');
        operation = sharp(imgBack)
          .composite(imgBuffer.map(input => {
            return { input, gravity: 'centre', blend: 'saturate' };
          }))
          .composite([{ input: dataBuffer, gravity: 'centre', blend: 'dest-in' }]);
      } else {
        operation = sharp(imgBack)
          .composite(imgBuffer.map(input => {
            return { input, gravity: 'centre', blend: 'saturate' };
          }));
      }

      await operation.toFile(savePath);
      return { success: true };
    } catch (err) {
      console.error('合并图片错误', err);
      try {
        fs.unlinkSync(path.normalize(args.savePath));
      } catch {
        // do nothing
      }
      return { success: false, error: err.message };
    }
  });

}
