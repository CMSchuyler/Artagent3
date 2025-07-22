import axios from 'axios';
import CryptoJS from 'crypto-js';

export class LiblibAIService {
  private apiKey: string;
  private apiSecret: string;
  private baseURL: string = 'https://openapi.liblibai.cloud';
  // 只请求 /api/liblibai，剩下的路径和参数都交由 Edge Function 处理
  private proxyURL: string = '/api/liblibai';
  
  // 阿里云OSS基础URL
  public static ossBaseUrl: string = 'https://liblibai-airship-temp.oss-cn-beijing.aliyuncs.com';
  
  constructor(apiKey: string, apiSecret: string, baseURL?: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    if (baseURL) {
      this.baseURL = baseURL;
    }
  }

  // 生成随机字符串
  private generateNonce(length: number = 16): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // 根据提供的示例生成签名
  private generateUrlSignature(path: string): { signature: string; timestamp: number; signatureNonce: string } {
    const timestamp = Date.now(); // 当前时间戳
    const signatureNonce = this.generateNonce(16); // 随机字符串
    
    // 原文 = URl地址 + "&" + 毫秒时间戳 + "&" + 随机字符串
    const str = `${path}&${timestamp}&${signatureNonce}`;
    
    // 使用HMAC-SHA1算法生成签名
    const hash = CryptoJS.HmacSHA1(str, this.apiSecret).toString(CryptoJS.enc.Base64);
    
    // 转换为URL安全的Base64字符串
    const signature = hash
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    
    return {
      signature,
      timestamp,
      signatureNonce
    };
  }

  // 构建带签名的URL参数
  private buildSignatureParams(path: string): string {
    const { signature, timestamp, signatureNonce } = this.generateUrlSignature(path);
    return `AccessKey=${this.apiKey}&Signature=${signature}&Timestamp=${timestamp}&SignatureNonce=${signatureNonce}`;
  }

  // 获取上传签名
  private async getUploadSignature(filename: string, extension: string): Promise<any> {
    try {
      console.log('获取上传签名...');
      
      // 构建请求路径
      const path = '/api/generate/upload/signature';
      const signatureParams = this.buildSignatureParams(path);
      
      console.log('签名请求URL:', this.proxyURL);
      
      // 请求数据
      const data = {
        name: filename,
        extension: extension
      };
      
      console.log('签名请求数据:', data);
      
      // 发送请求
      const response = await axios.post(this.proxyURL, {
        path,
        signatureParams,
        data: data
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        withCredentials: false,
        timeout: 30000
      });
      
      console.log('获取签名响应:', response.data);
      
      if (response.data.code !== 0) {
        throw new Error(`获取签名失败: ${response.data.msg}`);
      }
      
      // 获取签名数据
      const signatureData = response.data.data;
      
      // 保存原始URL
      if (signatureData.postUrl) {
        signatureData.originalPostUrl = signatureData.postUrl;
        
        // 修改为使用我们的代理
        signatureData.postUrl = signatureData.postUrl.replace(
          'https://liblibai-airship-temp.oss-cn-beijing.aliyuncs.com',
          '/oss-proxy'
        );
        
        console.log('原始OSS上传地址:', signatureData.originalPostUrl);
        console.log('代理后OSS上传地址:', signatureData.postUrl);
      }
      
      return signatureData;
    } catch (error) {
      console.error('获取上传签名失败:', error);
      if (axios.isAxiosError(error)) {
        if (error.response) {
          console.error('响应状态:', error.response.status);
          console.error('响应数据:', error.response.data);
        } else {
          console.error('网络错误，可能是CORS问题');
        }
      }
      throw error;
    }
  }
  
  // 上传到OSS
  private async uploadToOSS(fileBuffer: ArrayBuffer, signatureData: any, filename: string): Promise<string> {
    try {
      console.log('开始上传到OSS...');
      console.log('OSS上传地址:', signatureData.postUrl);
      console.log('完整的签名数据:', signatureData);
      
      // 创建FormData对象
      const formData = new FormData();
      
      // 按照阿里云OSS要求添加表单字段（注意顺序）
      // 1. 首先添加所有OSS需要的字段
      formData.append('key', signatureData.key);
      formData.append('policy', signatureData.policy);
      formData.append('x-oss-signature', signatureData.xOssSignature);
      formData.append('x-oss-credential', signatureData.xOssCredential);
      formData.append('x-oss-date', signatureData.xOssDate);
      formData.append('x-oss-expires', signatureData.xOssExpires.toString());
      formData.append('x-oss-signature-version', signatureData.xOssSignatureVersion);
      
      // 2. 最后添加文件（必须是最后一个字段）
      // 确定正确的MIME类型
      const extension = filename.split('.').pop()?.toLowerCase();
      let contentType = 'application/octet-stream';
      
      if (extension === 'jpg' || extension === 'jpeg') {
        contentType = 'image/jpeg';
      } else if (extension === 'png') {
        contentType = 'image/png';
      }
      
      console.log('使用Content-Type:', contentType);
      
      // 创建正确MIME类型的Blob
      const blob = new Blob([fileBuffer], { type: contentType });
      formData.append('file', blob, filename);
      
      // 打印表单字段，用于调试
      console.log('表单字段:');
      for (const pair of formData.entries()) {
        if (pair[0] !== 'file') {
          console.log(pair[0], pair[1]);
        } else {
          console.log(pair[0], '(文件数据)', '类型:', (pair[1] as Blob).type);
        }
      }
      
      // 使用原生fetch API发送请求
      console.log('发送上传请求到:', signatureData.postUrl);
      const response = await fetch(signatureData.postUrl, {
        method: 'POST',
        body: formData,
        // 不设置任何headers，让浏览器自动设置
      });
      
      console.log('OSS上传响应状态:', response.status);
      
      // OSS成功上传后可能没有响应体，或者是XML格式
      if (response.status >= 200 && response.status < 300) {
        console.log('上传成功');
        return signatureData.key; // 返回key用于后续API调用
      } else {
        const responseText = await response.text();
        console.error('OSS上传响应内容:', responseText);
        throw new Error(`上传失败，状态码: ${response.status}, 响应: ${responseText}`);
      }
    } catch (error) {
      console.error('上传到OSS失败:', error);
      if (error instanceof Error) {
        console.error('错误信息:', error.message);
        if ('stack' in error) {
          console.error('错误堆栈:', error.stack);
        }
      }
      throw error;
    }
  }
  
  // 上传文件方法，使用两步上传
  public async uploadFile(fileBuffer: ArrayBuffer, filename: string): Promise<{key: string, ossBaseUrl: string}> {
    try {
      console.log('开始两步上传文件流程...');
      
      // 从文件名获取扩展名
      const extension = filename.split('.').pop()?.toLowerCase() || 'png';
      if (!['jpg', 'jpeg', 'png'].includes(extension)) {
        throw new Error('文件类型必须是jpg、jpeg或png');
      }
      
      // 标准化扩展名 - 将jpeg转换为jpg以匹配API要求
      const normalizedExtension = extension === 'jpeg' ? 'jpg' : extension;
      
      // 构建用于签名的文件名（不含扩展名）
      const filenameWithoutExt = filename.split('.')[0] || 'image';
      
      // 1. 获取上传签名
      const signatureData = await this.getUploadSignature(
        filenameWithoutExt,
        normalizedExtension
      );
      
      // 确保上传的文件名与签名中使用的扩展名一致
      const uploadFilename = `${filenameWithoutExt}.${normalizedExtension}`;
      console.log('使用上传文件名:', uploadFilename);
      
      // 2. 上传到OSS
      const key = await this.uploadToOSS(fileBuffer, signatureData, uploadFilename);
      
      // 返回key和ossBaseUrl用于后续API调用
      return {
        key,
        ossBaseUrl: LiblibAIService.ossBaseUrl
      };
    } catch (error) {
      console.error('文件上传失败:', error);
      throw error;
    }
  }

  // 运行ComfyUI工作流
  public async runComfy(params: {
    templateUuid: string;
    generateParams: {
      workflowUuid: string;
      [key: string]: any;
    };
  }): Promise<string> {
    try {
      console.log('开始运行ComfyUI工作流...');
      
      // 处理参数中可能存在的图片URL问题
      if (params.generateParams && params.generateParams["190"] && 
          params.generateParams["190"].inputs && 
          params.generateParams["190"].inputs.image) {
        
        let imageUrl = params.generateParams["190"].inputs.image;
        
        // 确保imageUrl是字符串
        if (typeof imageUrl !== 'string') {
          console.error('图片URL不是字符串:', imageUrl);
          
          // 如果是对象，可能包含key属性
          if (imageUrl && typeof imageUrl === 'object' && 'key' in imageUrl) {
            // @ts-ignore
            imageUrl = imageUrl.key;
            console.log('从对象中提取key:', imageUrl);
          } else {
            throw new Error('无效的图片URL格式');
          }
        }
        
        // 检查是否是完整URL
        if (typeof imageUrl === 'string' && !imageUrl.startsWith('http')) {
          // 如果只是key，则组合完整URL
          imageUrl = `${LiblibAIService.ossBaseUrl}/${imageUrl}`;
          console.log('构建完整图片URL:', imageUrl);
        }
        
        // 更新参数中的图片URL
        params.generateParams["190"].inputs.image = imageUrl;
      }
      
      console.log('ComfyUI参数:', JSON.stringify(params, null, 2));
      
      // 使用正确的API路径
      const path = '/api/generate/comfyui/app';
      const signatureParams = this.buildSignatureParams(path);
      
      // 只请求 /api/liblibai，参数放 body
      const response = await axios.post(this.proxyURL, {
        path,
        signatureParams,
        data: params
      }, {
        headers: { 'Content-Type': 'application/json' },
        withCredentials: false,
        timeout: 30000
      });
      
      console.log('生成响应:', response.data);
      
      if (response.data.code !== 0) {
        throw new Error(`Generation failed: ${response.data.msg}`);
      }
      
      return response.data.data.generateUuid;
    } catch (error) {
      console.error('Error running ComfyUI workflow:', error);
      if (axios.isAxiosError(error)) {
        console.error('请求配置:', error.config);
        if (error.response) {
          console.error('响应状态:', error.response.status);
          console.error('响应数据:', error.response.data);
        } else {
          console.error('网络错误，可能是CORS问题');
        }
      }
      throw error;
    }
  }

  // 获取生成状态
  public async getComfyStatus(generateUuid: string): Promise<any> {
    try {
      console.log(`获取生成状态, UUID: ${generateUuid}`);
      
      // 使用正确的API路径
      const path = `/api/generate/comfy/status`;
      const signatureParams = this.buildSignatureParams(path);
      
      // 只请求 /api/liblibai，参数放 body
      const response = await axios.post(this.proxyURL, {
        path,
        signatureParams,
        data: { generateUuid }
      }, {
        headers: { 'Content-Type': 'application/json' },
        withCredentials: false,
        timeout: 30000
      });
      
      console.log('查询响应:', response.data);
      
      if (response.data.code !== 0) {
        throw new Error(`Query failed: ${response.data.msg}`);
      }
      
      return response.data.data;
    } catch (error) {
      console.error('Error getting generation status:', error);
      if (axios.isAxiosError(error)) {
        if (error.response) {
          console.error('响应状态:', error.response.status);
          console.error('响应数据:', error.response.data);
        } else {
          console.error('网络错误，可能是CORS问题');
        }
      }
      throw error;
    }
  }

  // 等待生成结果
  public async waitAppResult(generateUuid: string, maxAttempts: number = 60, interval: number = 3000): Promise<string> {
    console.log(`开始轮询生成结果, UUID: ${generateUuid}`);
    
    // 生成状态枚举
    enum GenerateStatus {
      PENDING = 1,
      PROCESSING = 2,
      GENERATED = 3,
      AUDITING = 4,
      SUCCESS = 5,
      FAILED = 6,
      TIMEOUT = 7
    }
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`轮询尝试 ${attempt}/${maxAttempts}`);
        const status = await this.getComfyStatus(generateUuid);
        console.log(`轮询尝试 ${attempt}, 状态: ${status.generateStatus}`);
        
        if (status.generateStatus === GenerateStatus.SUCCESS) {
          // 返回第一张图片的URL
          if (status.images && status.images.length > 0) {
            console.log('生成成功，图片URL:', status.images[0].imageUrl);
            return status.images[0].imageUrl;
          }
          throw new Error('No images found in successful generation result');
        } else if ([GenerateStatus.FAILED, GenerateStatus.TIMEOUT].includes(status.generateStatus)) {
          // 对于失败或超时状态，不在catch块中重试，而是直接结束轮询
          console.error(`生成失败或超时，状态: ${status.generateStatus}, 原因: ${status.failReason || '未知'}`);
          throw new Error(`Image generation ${status.generateStatus === GenerateStatus.FAILED ? 'failed' : 'timed out'}: ${status.failReason || 'Unknown reason'}`);
        }
        
        // 等待指定时间后再次查询
        console.log(`等待${interval/1000}秒后再次查询...`);
        await new Promise(resolve => setTimeout(resolve, interval));
      } catch (error) {
        console.error(`Polling attempt ${attempt} failed:`, error);
        
        // 如果错误信息中包含"failed"或"timed out"，表示是状态为FAILED或TIMEOUT引起的错误，不再重试
        if (error instanceof Error && 
            (error.message.includes('failed') || 
             error.message.includes('timed out'))) {
          console.log('检测到失败或超时状态，终止轮询');
          throw error;
        }
        
        if (attempt === maxAttempts) {
          throw error;
        }
        
        // 等待后重试
        console.log(`轮询失败，等待${interval/1000}秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }
    
    throw new Error('Max polling attempts reached');
  }

  // 为了兼容之前的代码，保留这些方法
  public async generateImage(params: {
    templateUuid: string;
    workflowUuid: string;
    width: number;
    height: number;
    uploadedUrl: string | {key: string, ossBaseUrl?: string};
    prompt: string;
  }): Promise<string> {
    try {
      console.log('开始生成图像，参数:', params);
      
      // 检查uploadedUrl是否是完整URL或仅是key
      let imageUrl: string;
      
      // 确保imageUrl是字符串
      if (typeof params.uploadedUrl !== 'string') {
        console.error('uploadedUrl不是字符串:', params.uploadedUrl);
        
        // 如果是对象，可能包含key属性
        const uploadObj = params.uploadedUrl as {key: string, ossBaseUrl?: string};
        if (uploadObj && uploadObj.key) {
          // 如果有ossBaseUrl属性，使用它构建URL
          if (uploadObj.ossBaseUrl) {
            imageUrl = `${uploadObj.ossBaseUrl}/${uploadObj.key}`;
          } else {
            // 否则使用默认的ossBaseUrl
            imageUrl = `${LiblibAIService.ossBaseUrl}/${uploadObj.key}`;
          }
          console.log('从对象中构建URL:', imageUrl);
        } else {
          throw new Error('无效的图片URL格式');
        }
      } else {
        imageUrl = params.uploadedUrl;
      }
      
      // 检查是否是完整URL
      if (typeof imageUrl === 'string' && !imageUrl.startsWith('http')) {
        // 如果只是key，则组合完整URL
        imageUrl = `${LiblibAIService.ossBaseUrl}/${imageUrl}`;
        console.log('构建完整图片URL:', imageUrl);
      }
      
      const comfyParams = {
        templateUuid: params.templateUuid,
        generateParams: {
          workflowUuid: params.workflowUuid,
          "188": {
            class_type: "EmptySD3LatentImage",
            inputs: {
              width: params.width,
              height: params.height,
              batch_size: 1
            }
          },
          "190": {
            class_type: "LoadImage",
            inputs: {
              image: imageUrl
            }
          },
          "240": {
            class_type: "LibLibTranslate",
            inputs: {
              text: params.prompt
            }
          }
        }
      };
      
      console.log('ComfyUI参数:', JSON.stringify(comfyParams, null, 2));
      const generateUuid = await this.runComfy(comfyParams);
      console.log('生成UUID:', generateUuid);
      return generateUuid;
    } catch (error) {
      console.error('生成图像失败:', error);
      throw error;
    }
  }
  
  public async pollGenerationResult(generateUuid: string, maxAttempts: number = 60): Promise<string> {
    return this.waitAppResult(generateUuid, maxAttempts);
  }
}

// 创建服务实例
export const liblibAIService = new LiblibAIService(
  'LEwIdqsvxwYqVBixl77oMA',
  'vYTzHMKn0NTFmswXCq_MoVnAmDpL6ybA',
  'https://openapi.liblibai.cloud'
); 
