export interface DeletionItem {id:string;name:string;channel:string}
export interface MemberDeletionImpact {
  email:string;name:string;projects:DeletionItem[];media:DeletionItem[];profiles:DeletionItem[];
  preparations:DeletionItem[];programmes:DeletionItem[];affected:DeletionItem[];
  comments:number;assignments:number;
}
export interface MemberDeletionPreview {token:string;expiresAt:number;impact:MemberDeletionImpact}
export interface MemberDeletionJob {id:string;email:string;mediaRemaining:number;identityDeleted:boolean}
